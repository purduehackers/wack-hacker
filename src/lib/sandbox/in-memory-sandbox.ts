import type {
  DirEntry,
  ExecHandler,
  ExecOptions,
  ExecResult,
  InMemorySandboxOptions,
  Sandbox,
  SandboxHooks,
  SandboxStats,
  SnapshotResult,
  StreamExecChunk,
} from "./types.ts";

export type { ExecHandler, InMemorySandboxOptions } from "./types.ts";

const DEFAULT_WORKING_DIRECTORY = "/vercel/sandbox";

/**
 * Test double for `Sandbox`. Files live in a Map; `exec` defaults to a no-op
 * that returns exit code 0. Supply `execHandler` to simulate git/bash/tests
 * for specific unit tests.
 *
 * Not used in production — real work runs against `VercelSandbox`. The split
 * exists so tool tests don't need to mock `@vercel/sandbox` or stub network
 * policy internals.
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
  private expiresAt = Date.now() + 30 * 60 * 1000;

  constructor(options: InMemorySandboxOptions = {}) {
    this.name = options.name ?? "in-memory";
    this.workingDirectory = options.workingDirectory ?? DEFAULT_WORKING_DIRECTORY;
    this.currentBranch = options.currentBranch;
    this.hooks = options.hooks;
    this.files = new Map(Object.entries(options.files ?? {}));
    this.directories = new Set([this.workingDirectory]);
    // Any seeded file implies its ancestor directories exist too.
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

  /** Directly seed/overwrite a file. Test-only; real code goes through `writeFile`. */
  seedFile(path: string, content: string): void {
    this.files.set(path, content);
    this.ensureParentDirs(path);
  }

  /** List every path currently in the in-memory filesystem. Test-only. */
  listFiles(): string[] {
    return Array.from(this.files.keys()).sort();
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
    // Fall back to the single-shot handler and replay its output as one
    // stdout chunk followed by one stderr chunk. Tests that want finer-grained
    // streaming can supply a custom `execHandler` + override directly.
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
    this.expiresAt += additionalMs;
    return { expiresAt: this.expiresAt };
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
