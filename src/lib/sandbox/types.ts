import type { RedisLike } from "@/bot/types";

/**
 * Sandbox abstraction used by the coding subagent.
 *
 * The agent (a nested `ToolLoopAgent` in `src/lib/ai/subagent.ts`) runs in the
 * Vercel function. Its tools (`src/lib/ai/tools/code/`) call into this
 * interface to read/write files and run shell commands against an isolated
 * Firecracker microVM. This mirrors the open-agents `packages/sandbox`
 * contract so tool code is sandbox-implementation-agnostic — real runs use
 * `VercelSandbox`; tests use `InMemorySandbox`.
 */
export interface Sandbox {
  /** Stable persistent identifier. Used for reconnecting across function invocations. */
  readonly name: string;
  /** Working directory where the repo is cloned (e.g. `/vercel/sandbox`). */
  readonly workingDirectory: string;
  /** Feature branch created by `afterStart` — what the agent commits onto. */
  readonly currentBranch?: string;
  /** Lifecycle hooks; wired by the factory, invoked by the implementation. */
  readonly hooks?: SandboxHooks;

  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  stat(path: string): Promise<SandboxStats>;
  readdir(path: string): Promise<DirEntry[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;

  /** Bump the sandbox's wall-clock deadline. No-op on in-memory impls. */
  extendTimeout(additionalMs: number): Promise<{ expiresAt: number }>;
  /** Stop and clean up; runs `beforeStop` hook first. Idempotent. */
  stop(): Promise<void>;
}

export interface SandboxHooks {
  /** Runs after the sandbox is created and ready — clone, branch, set up git. */
  afterStart?: (sandbox: Sandbox) => Promise<void>;
  /** Runs before the sandbox stops — e.g. last-ditch commit. Errors logged, not thrown. */
  beforeStop?: (sandbox: Sandbox) => Promise<void>;
}

export interface ExecOptions {
  /** Directory the command runs in. Defaults to `workingDirectory`. */
  cwd?: string;
  /** Wall-clock cap for the command. Defaults to 120_000. */
  timeoutMs?: number;
  /** Environment variables merged on top of the sandbox's baseline. */
  env?: Record<string, string>;
  /** Aborts the command when triggered. Usually the AI SDK's tool abort. */
  signal?: AbortSignal;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True when stdout was clipped at the output cap. */
  truncated: boolean;
}

export interface SandboxStats {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
}

export interface DirEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
}

// ─── in-memory-sandbox ────────────────────────────────────────────────────

export type ExecHandler = (
  command: string,
  options: Required<Pick<ExecOptions, "cwd">> & ExecOptions,
) => Promise<ExecResult> | ExecResult;

export interface InMemorySandboxOptions {
  name?: string;
  workingDirectory?: string;
  currentBranch?: string;
  hooks?: SandboxHooks;
  /** Custom exec handler — default returns exit 0 with empty output. */
  execHandler?: ExecHandler;
  /** Seed files: path (absolute) → content. */
  files?: Record<string, string>;
}

// ─── credential-brokering ─────────────────────────────────────────────────

export interface NetworkPolicyTransform {
  headers?: Record<string, string>;
}

export interface NetworkPolicyRule {
  transform?: NetworkPolicyTransform[];
}

export interface NetworkPolicy {
  allow: Record<string, NetworkPolicyRule[]>;
}

// ─── vercel-sandbox ───────────────────────────────────────────────────────

export interface VercelSandboxCreateOptions {
  /** GitHub installation token used only for the sandbox's network policy. */
  githubToken?: string;
  /** Base snapshot to bootstrap from. Unset → fresh install path. */
  baseSnapshotId?: string;
  /** Wall-clock cap in ms. Defaults to 30 min. */
  timeoutMs?: number;
  /** vCPU count; 2048 MB RAM per vCPU. */
  vcpus?: number;
  /** Runtime. Defaults to `node24`. */
  runtime?: "node22" | "node24" | "python3.13";
  /** Env vars available to every `exec`. */
  env?: Record<string, string>;
  /** Lifecycle hooks — afterStart fires before `create` returns. */
  hooks?: SandboxHooks;
}

export interface VercelSandboxReconnectOptions {
  githubToken?: string;
  env?: Record<string, string>;
  hooks?: SandboxHooks;
}

// ─── hooks ────────────────────────────────────────────────────────────────

export interface SandboxHooksConfig {
  repo: string;
  baseBranch?: string;
  branch: string;
  gitUser: { name: string; email: string };
  /** When true, skip apt-get install (the snapshot already has tools). */
  hasBaseSnapshot: boolean;
}

// ─── factory ──────────────────────────────────────────────────────────────

export interface CreateCodingSandboxConfig {
  /** `owner/repo` — the GitHub repository to clone. */
  repo: string;
  /** GitHub App installation token; used only for network policy brokering. */
  githubToken: string;
  /** Feature branch to create and switch to after clone. */
  branch: string;
  /** Base branch to clone. Defaults to the repo's default branch. */
  baseBranch?: string;
  /** Git identity for commits the agent creates. */
  gitUser: { name: string; email: string };
  /** Wall-clock sandbox deadline in ms. */
  timeoutMs?: number;
  /** Optional pre-built base snapshot id (skips install-on-boot when set). */
  baseSnapshotId?: string;
}

// ─── session ──────────────────────────────────────────────────────────────

/**
 * Shape stored in Redis under `sandbox:session:{threadKey}`. `Sandbox`
 * handles aren't serializable, but `sandboxId` is enough to reconnect on the
 * next delegate invocation.
 */
export interface SandboxSessionMetadata {
  sandboxId: string;
  repo: string;
  branch: string;
  repoDir: string;
  /** ms since epoch — when the sandbox will self-stop if not extended. */
  expiresAt: number;
}

export interface SandboxSession {
  sandbox: Sandbox;
  metadata: SandboxSessionMetadata;
  /** True if this invocation created a fresh sandbox (vs reusing a cached one). */
  fresh: boolean;
}

export interface GetOrCreateSessionParams {
  threadKey: string;
  repo: string;
  githubToken: string;
  gitUser: { name: string; email: string };
  /** Feature branch to create when provisioning fresh. */
  branch?: string;
  baseBranch?: string;
  baseSnapshotId?: string;
  timeoutMs?: number;
  redis?: RedisLike;
}
