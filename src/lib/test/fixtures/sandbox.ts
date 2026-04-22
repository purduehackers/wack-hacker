import type {
  CreateCodingSandboxConfig,
  DirEntry,
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxHooks,
  SandboxProvider,
  SandboxStats,
  SnapshotResult,
  StreamExecChunk,
  VercelSandboxReconnectOptions,
} from "@/lib/sandbox/types";

import type {
  ExecHandler,
  InMemorySandboxOptions,
  TestSandboxProvider,
  TestSandboxProviderOptions,
} from "../types";

export type {
  ExecHandler,
  InMemorySandboxOptions,
  TestSandboxProvider,
  TestSandboxProviderOptions,
} from "../types";

const DEFAULT_WORKING_DIRECTORY = "/vercel/sandbox";

/**
 * In-memory `Sandbox` test double. Files live in a `Map`; `exec` defaults to
 * a no-op returning exit 0. Supply `execHandler` to simulate git/bash/tests
 * for specific unit tests. Never used in production — coding tasks run
 * against `VercelSandbox`.
 */
export class InMemorySandbox implements Sandbox {
  readonly name: string;
  readonly workingDirectory: string;
  readonly currentBranch?: string;
  readonly hooks?: SandboxHooks;

  private files: Map<string, string>;
  private directories: Set<string>;
  private execHandler: ExecHandler;
  private stopped = false;
  private deadline = Date.now() + 30 * 60 * 1000;

  constructor(options: InMemorySandboxOptions = {}) {
    this.name = options.name ?? "in-memory";
    this.workingDirectory = options.workingDirectory ?? DEFAULT_WORKING_DIRECTORY;
    this.currentBranch = options.currentBranch;
    this.hooks = options.hooks;
    this.files = new Map(Object.entries(options.files ?? {}));
    this.directories = new Set([this.workingDirectory]);
    for (const path of this.files.keys()) {
      this.ensureParentDirs(path);
    }
    this.execHandler = options.execHandler ?? defaultExecHandler;
  }

  private ensureParentDirs(filePath: string): void {
    const parts = filePath.split("/").filter(Boolean);
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc += `/${parts[i]}`;
      this.directories.add(acc);
    }
  }

  private assertAlive(operation: string): void {
    if (this.stopped) {
      throw new Error(`Sandbox is stopped; cannot ${operation}`);
    }
  }

  async readFile(path: string): Promise<string> {
    this.assertAlive("readFile");
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file '${path}'`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.assertAlive("writeFile");
    this.files.set(path, content);
    this.ensureParentDirs(path);
  }

  async stat(path: string): Promise<SandboxStats> {
    this.assertAlive("stat");
    if (this.files.has(path)) {
      return {
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: this.files.get(path)!.length,
      };
    }
    if (this.directories.has(path)) {
      return { isFile: false, isDirectory: true, isSymlink: false, size: 0 };
    }
    throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
  }

  async readdir(path: string): Promise<DirEntry[]> {
    this.assertAlive("readdir");
    if (!this.directories.has(path)) {
      throw new Error(`ENOENT: no such directory '${path}'`);
    }
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const entries = new Map<string, DirEntry["type"]>();
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const segment = rest.split("/")[0] ?? "";
      if (!segment) continue;
      entries.set(segment, rest.includes("/") ? "directory" : "file");
    }
    for (const dir of this.directories) {
      if (!dir.startsWith(prefix)) continue;
      const rest = dir.slice(prefix.length);
      const segment = rest.split("/")[0] ?? "";
      if (segment) entries.set(segment, "directory");
    }
    return Array.from(entries.entries()).map(([name, type]) => ({ name, type }));
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.assertAlive("mkdir");
    if (options?.recursive) {
      this.ensureParentDirs(`${path}/_`);
    }
    this.directories.add(path);
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    this.assertAlive("exec");
    const resolved = { cwd: options.cwd ?? this.workingDirectory, ...options };
    return this.execHandler(command, resolved);
  }

  async *streamExec(command: string, options: ExecOptions = {}): AsyncIterable<StreamExecChunk> {
    this.assertAlive("streamExec");
    const result = await this.exec(command, options);
    if (result.stdout) yield { stream: "stdout", data: result.stdout };
    if (result.stderr) yield { stream: "stderr", data: result.stderr };
  }

  domain(port: number): string {
    return `https://${this.name}-${port}.example.test`;
  }

  async snapshot(): Promise<SnapshotResult> {
    this.stopped = true;
    return { snapshotId: `in-mem-${this.name}-${Date.now()}` };
  }

  async extendTimeout(additionalMs: number): Promise<{ expiresAt: number }> {
    this.deadline += additionalMs;
    return { expiresAt: this.deadline };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.hooks?.beforeStop) {
      try {
        await this.hooks.beforeStop(this);
      } catch {
        // match VercelSandbox: beforeStop errors are logged, not propagated
      }
    }
  }

  /** Test helper — fire `afterStart` manually (factory usually does this). */
  async fireAfterStart(): Promise<void> {
    if (this.hooks?.afterStart) await this.hooks.afterStart(this);
  }
}

const defaultExecHandler: ExecHandler = async () => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
  truncated: false,
});

/**
 * Build a `SandboxProvider` backed by `InMemorySandbox` for unit tests. The
 * returned state object exposes call logs + helpers so tests can drive and
 * assert on provider behaviour without mocking any internal modules.
 *
 * - `create` spawns a new `InMemorySandbox` for each call, wraps its `stop`
 *   to record the id in `stoppedIds`, and caches the sandbox for subsequent
 *   `reconnect` calls with the same id.
 * - `reconnect` returns the cached sandbox (or creates one on-the-fly for ids
 *   the test seeds into Redis externally).
 * - `failReconnectOnce()` primes the next `reconnect` call to throw.
 */
export function createTestSandboxProvider(
  options: TestSandboxProviderOptions = {},
): TestSandboxProvider {
  const createCalls: CreateCodingSandboxConfig[] = [];
  const reconnectCalls: { id: string; options: VercelSandboxReconnectOptions }[] = [];
  const stoppedIds: string[] = [];
  const knownSandboxes = new Map<string, InMemorySandbox>();
  let counter = 0;
  let pendingReconnectFailure = Boolean(options.reconnectFails);

  const nextName = () => options.name ?? `sb-${counter++}`;

  function trackStop(sandbox: InMemorySandbox): InMemorySandbox {
    const originalStop = sandbox.stop.bind(sandbox);
    sandbox.stop = async () => {
      stoppedIds.push(sandbox.name);
      await originalStop();
    };
    return sandbox;
  }

  const provider: SandboxProvider = {
    create: async (config) => {
      createCalls.push(config);
      const fresh = trackStop(
        new InMemorySandbox({
          name: nextName(),
          execHandler: options.execHandler,
        }),
      );
      knownSandboxes.set(fresh.name, fresh);
      return fresh;
    },
    reconnect: async (id, opts) => {
      reconnectCalls.push({ id, options: opts });
      if (pendingReconnectFailure) {
        pendingReconnectFailure = false;
        throw new Error("reconnect failed");
      }
      const existing = knownSandboxes.get(id);
      if (existing) return existing;
      const fresh = trackStop(
        new InMemorySandbox({
          name: id,
          execHandler: options.execHandler,
        }),
      );
      knownSandboxes.set(id, fresh);
      return fresh;
    },
  };

  return {
    provider,
    createCalls,
    reconnectCalls,
    stoppedIds,
    sandboxesById: knownSandboxes,
    failReconnectOnce: () => {
      pendingReconnectFailure = true;
    },
  };
}
