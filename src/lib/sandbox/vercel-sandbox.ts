import { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";

import type {
  DirEntry,
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxHooks,
  SandboxStats,
  SnapshotResult,
  StreamExecChunk,
  VercelSandboxCreateOptions,
  VercelSandboxReconnectOptions,
} from "./types.ts";

import { buildGitHubCredentialBrokeringPolicy } from "./credential-brokering.ts";

export type { VercelSandboxCreateOptions, VercelSandboxReconnectOptions } from "./types.ts";

const MAX_OUTPUT_LENGTH = 50_000;
const DEFAULT_WORKING_DIRECTORY = "/vercel/sandbox";
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
const DEFAULT_SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;
const TIMEOUT_HOOK_LEAD_MS = 30_000;

interface VercelSandboxConstructorArgs {
  sdk: VercelSandboxSDK;
  name: string;
  workingDirectory: string;
  env?: Record<string, string>;
  hooks?: SandboxHooks;
  currentBranch?: string;
  /** Absolute ms-since-epoch deadline; seeded by create/reconnect, incremented on extendTimeout. */
  expiresAt: number;
  ports?: number[];
}

/**
 * Vercel Sandbox implementation of the `Sandbox` interface. Wraps
 * `@vercel/sandbox` v1.10 while preserving the simpler open-agents-style
 * contract our tools actually use (no preview URLs, no detached commands, no
 * snapshot helpers — those are deferred per the v2 plan).
 *
 * A `VercelSandbox` IS its own session: the underlying SDK exposes a single
 * durable handle, reconnect via `Sandbox.get({ sandboxId })`. We persist the
 * id in Redis through `session.ts`; no separate "session" abstraction.
 */
export class VercelSandbox implements Sandbox {
  readonly name: string;
  readonly workingDirectory: string;
  currentBranch?: string;
  readonly hooks?: SandboxHooks;

  private sdk: VercelSandboxSDK;
  private env?: Record<string, string>;
  private stopped = false;
  private _expiresAt: number;
  private timeoutTimer?: ReturnType<typeof setTimeout>;
  readonly ports?: number[];

  private constructor(args: VercelSandboxConstructorArgs) {
    this.sdk = args.sdk;
    this.name = args.name;
    this.workingDirectory = args.workingDirectory;
    this.env = args.env;
    this.hooks = args.hooks;
    this.currentBranch = args.currentBranch;
    this._expiresAt = args.expiresAt;
    this.ports = args.ports;
    this.scheduleTimeoutHook();
  }

  /** Current absolute deadline (ms since epoch). Moves forward on extendTimeout. */
  get expiresAt(): number {
    return this._expiresAt;
  }

  private scheduleTimeoutHook(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
    if (!this.hooks?.onTimeout) return;
    const leadMs = this._expiresAt - Date.now() - TIMEOUT_HOOK_LEAD_MS;
    if (leadMs <= 0) return;
    this.timeoutTimer = setTimeout(() => {
      // Fire-and-forget; lifecycle owns the actual stop/snapshot decision.
      this.hooks?.onTimeout?.(this).catch(() => {
        // Hook errors are the lifecycle workflow's problem.
      });
    }, leadMs);
  }

  static async create(options: VercelSandboxCreateOptions = {}): Promise<VercelSandbox> {
    const {
      githubToken,
      baseSnapshotId,
      timeoutMs = DEFAULT_SANDBOX_TIMEOUT_MS,
      vcpus = 4,
      runtime = "node24",
      env,
      hooks,
      ports,
    } = options;

    // When a base snapshot is provided the SDK types disallow `runtime`
    // (the snapshot encodes it). We branch because the discriminated union
    // doesn't narrow from a spread.
    const sdk = await (baseSnapshotId
      ? VercelSandboxSDK.create({
          timeout: timeoutMs,
          resources: { vcpus },
          networkPolicy: buildGitHubCredentialBrokeringPolicy(githubToken),
          env,
          ports,
          source: { type: "snapshot", snapshotId: baseSnapshotId },
        })
      : VercelSandboxSDK.create({
          timeout: timeoutMs,
          resources: { vcpus },
          runtime,
          networkPolicy: buildGitHubCredentialBrokeringPolicy(githubToken),
          env,
          ports,
        }));

    const sandbox = new VercelSandbox({
      sdk,
      name: sdk.sandboxId,
      workingDirectory: DEFAULT_WORKING_DIRECTORY,
      env,
      hooks,
      expiresAt: Date.now() + timeoutMs,
      ports,
    });

    if (hooks?.afterStart) {
      await hooks.afterStart(sandbox);
    }

    return sandbox;
  }

  static async reconnect(
    sandboxId: string,
    options: VercelSandboxReconnectOptions = {},
  ): Promise<VercelSandbox> {
    const sdk = await VercelSandboxSDK.get({ sandboxId });

    if (options.githubToken !== undefined) {
      await sdk.updateNetworkPolicy(buildGitHubCredentialBrokeringPolicy(options.githubToken));
    }

    // Reconnect callers (session.ts) know the cached deadline from Redis. Fall back
    // to a conservative "now + 5 min" when no expiry is supplied so calls to
    // extendTimeout still produce a monotonically increasing value.
    const seedExpiresAt = options.expiresAt ?? Date.now() + 5 * 60 * 1000;

    const sandbox = new VercelSandbox({
      sdk,
      name: sandboxId,
      workingDirectory: DEFAULT_WORKING_DIRECTORY,
      env: options.env,
      hooks: options.hooks,
      expiresAt: seedExpiresAt,
    });

    if (options.hooks?.afterStart) {
      await options.hooks.afterStart(sandbox);
    }

    return sandbox;
  }

  /** Record the feature branch the agent is working on (called by `afterStart`). */
  setCurrentBranch(branch: string): void {
    this.currentBranch = branch;
  }

  private mergedEnv(extra?: Record<string, string>): Record<string, string> | undefined {
    if (!this.env && !extra) return undefined;
    return { ...this.env, ...extra };
  }

  async readFile(path: string): Promise<string> {
    return this.sdk.fs.readFile(path, { encoding: "utf-8" });
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.sdk.fs.writeFile(path, content);
  }

  async stat(path: string): Promise<SandboxStats> {
    const s = await this.sdk.fs.stat(path);
    return {
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
      isSymlink: s.isSymbolicLink(),
      size: s.size,
    };
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const entries = await this.sdk.fs.readdir(path, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      type: e.isDirectory()
        ? "directory"
        : e.isFile()
          ? "file"
          : e.isSymbolicLink()
            ? "symlink"
            : "other",
    }));
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.sdk.fs.mkdir(path, { recursive: options?.recursive ?? false });
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const cwd = options.cwd ?? this.workingDirectory;
    const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([timeoutSignal, options.signal])
      : timeoutSignal;

    try {
      const result = await this.sdk.runCommand({
        cmd: "bash",
        args: ["-c", command],
        cwd,
        env: this.mergedEnv(options.env),
        signal,
      });

      const [stdoutRaw, stderrRaw] = await Promise.all([result.stdout(), result.stderr()]);

      let stdout = stdoutRaw;
      let truncated = false;
      if (stdout.length > MAX_OUTPUT_LENGTH) {
        stdout = stdout.slice(0, MAX_OUTPUT_LENGTH);
        truncated = true;
      }

      let stderr = stderrRaw;
      if (stderr.length > MAX_OUTPUT_LENGTH) {
        stderr = stderr.slice(0, MAX_OUTPUT_LENGTH);
        truncated = true;
      }

      return { exitCode: result.exitCode, stdout, stderr, truncated };
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        return {
          exitCode: null,
          stdout: "",
          stderr: `Command timed out after ${timeoutMs}ms`,
          truncated: false,
        };
      }
      if (err instanceof Error && err.name === "AbortError") throw err;
      return {
        exitCode: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        truncated: false,
      };
    }
  }

  async extendTimeout(additionalMs: number): Promise<{ expiresAt: number }> {
    await this.sdk.extendTimeout(additionalMs);
    // Extension is relative to the existing deadline, not to now — matches the
    // Sandbox contract (and InMemorySandbox's semantics). session.ts then
    // persists the new value to Redis.
    this._expiresAt += additionalMs;
    this.scheduleTimeoutHook();
    return { expiresAt: this._expiresAt };
  }

  async *streamExec(command: string, options: ExecOptions = {}): AsyncIterable<StreamExecChunk> {
    const cwd = options.cwd ?? this.workingDirectory;
    const detached = await this.sdk.runCommand({
      cmd: "bash",
      args: ["-c", command],
      cwd,
      env: this.mergedEnv(options.env),
      detached: true,
    });

    const logs = detached.logs({ signal: options.signal });
    try {
      let total = 0;
      for await (const entry of logs) {
        total += entry.data.length;
        yield { stream: entry.stream, data: entry.data };
        if (total > MAX_OUTPUT_LENGTH) {
          // Truncate silently; further output discarded so the tool stream
          // doesn't overwhelm Discord.
          break;
        }
      }
      await detached.wait({ signal: options.signal });
    } finally {
      logs.close();
    }
  }

  domain(port: number): string {
    return this.sdk.domain(port);
  }

  async snapshot(): Promise<SnapshotResult> {
    // The SDK's snapshot call stops the sandbox as a side effect. Clear our
    // timeout hook so it doesn't fire against a dead VM.
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
    const snap = await this.sdk.snapshot();
    this.stopped = true;
    return { snapshotId: snap.snapshotId };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }

    if (this.hooks?.beforeStop) {
      try {
        await this.hooks.beforeStop(this);
      } catch (err) {
        console.error(
          "[VercelSandbox] beforeStop hook failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    await this.sdk.stop();
  }
}
