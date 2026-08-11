import type { SandboxSession } from "eve/sandbox";

export const MAX_COMMAND_TIMEOUT_MS = 5 * 60_000;
export const MAX_COMMAND_OUTPUT_BYTES = 32_000;
export const MAX_TOOL_TEXT_BYTES = 64_000;

const SECRET_VALUE =
  /(?:gh[oprsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})/u;
const SECRET_ASSIGNMENT =
  /(?:token|secret|password|passwd|api[_-]?key|authorization|private[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/iu;
const PEM_BLOCK =
  /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CREDENTIALS?)-----[\s\S]*?-----END [A-Z0-9 ]+-----/gu;

const SENSITIVE_BASENAMES = new Set([
  ".dev.vars",
  ".env",
  ".envrc",
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".secrets",
  "auth.json",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "known_hosts",
  "kubeconfig",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "secrets.toml",
  "service-account.json",
  "service_account.json",
  "terraform.tfstate",
]);
const SENSITIVE_DIRECTORIES = new Set([
  ".aws",
  ".azure",
  ".docker",
  ".git",
  ".gnupg",
  ".kube",
  ".ssh",
]);

export interface BoundedCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputLimited: boolean;
  readonly durationMs: number;
}

export interface SafeText {
  readonly text: string;
  readonly redacted: boolean;
  readonly truncated: boolean;
}

/** Minimal Eve handle used by the safety boundary, derived from Eve's public type. */
export type SandboxCommandRunner = Pick<SandboxSession, "spawn">;

export function containsLikelySecret(value: string): boolean {
  SECRET_VALUE.lastIndex = 0;
  SECRET_ASSIGNMENT.lastIndex = 0;
  PEM_BLOCK.lastIndex = 0;
  return SECRET_VALUE.test(value) || SECRET_ASSIGNMENT.test(value) || PEM_BLOCK.test(value);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = Math.max(0, maxBytes);
  while (end > 0) {
    try {
      return decoder.decode(encoded.slice(0, end));
    } catch {
      end -= 1;
    }
  }
  return "";
}

export function sanitizeText(value: string, maxBytes = MAX_TOOL_TEXT_BYTES): SafeText {
  PEM_BLOCK.lastIndex = 0;
  let redacted = false;
  let text = value.replace(PEM_BLOCK, () => {
    redacted = true;
    return "[REDACTED PRIVATE MATERIAL]";
  });
  text = text.replace(
    /((?:token|secret|password|passwd|api[_-]?key|authorization|private[_-]?key)\s*[:=]\s*)[^\s,;]+/giu,
    (_match, prefix: string) => {
      redacted = true;
      return `${prefix}[REDACTED]`;
    },
  );
  text = text.replace(
    /(?:gh[oprsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})/gu,
    () => {
      redacted = true;
      return "[REDACTED TOKEN]";
    },
  );

  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= maxBytes) return { text, redacted, truncated: false };
  return { text: truncateUtf8(text, maxBytes), redacted, truncated: true };
}

export function isSensitivePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  const pathPieces = normalized.split("/").filter(Boolean);
  const joined = `/${pathPieces.join("/")}/`;
  if (/\/\.config\/(?:gcloud|gh)(?:\/|$)/u.test(joined)) return true;
  return pathPieces.some(
    (candidate) =>
      SENSITIVE_DIRECTORIES.has(candidate) ||
      SENSITIVE_BASENAMES.has(candidate) ||
      ((candidate === ".env" || candidate.startsWith(".env.")) && candidate !== ".env.example") ||
      candidate.endsWith(".key") ||
      candidate.endsWith(".pem") ||
      candidate.endsWith(".p12") ||
      candidate.endsWith(".pfx"),
  );
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * One capture budget shared by stdout and stderr: the cap is on total command
 * output, so the two concurrent readers must draw down the same counter and
 * raise the same limited flag.
 */
interface OutputBudget {
  captured: number;
  limited: boolean;
}

/** Reads one stream until it ends or the shared budget is exceeded. */
async function collectBoundedStream(input: {
  readonly budget: OutputBudget;
  readonly maxOutputBytes: number;
  readonly onLimitExceeded: () => Promise<void>;
  readonly stream: ReadableStream<Uint8Array>;
  readonly target: Uint8Array[];
}): Promise<void> {
  const reader = input.stream.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const remaining = Math.max(0, input.maxOutputBytes - input.budget.captured);
      if (remaining > 0) {
        const accepted =
          chunk.value.byteLength > remaining ? chunk.value.slice(0, remaining) : chunk.value;
        input.target.push(accepted);
        input.budget.captured += accepted.byteLength;
      }
      if (chunk.value.byteLength > remaining) {
        input.budget.limited = true;
        await input.onLimitExceeded();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function decodeByteGroups(byteGroups: readonly Uint8Array[]): string {
  const length = byteGroups.reduce((total, entry) => total + entry.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const entry of byteGroups) {
    bytes.set(entry, offset);
    offset += entry.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function runBoundedCommand(input: {
  readonly sandbox: SandboxCommandRunner;
  readonly command: string;
  readonly workingDirectory: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly abortSignal: AbortSignal;
}): Promise<BoundedCommandResult> {
  const startedAt = Date.now();
  const deadlineController = new AbortController();
  let timedOut = false;
  let process: Awaited<ReturnType<SandboxSession["spawn"]>> | undefined;
  let killRequested = false;

  const requestKill = async (): Promise<void> => {
    if (killRequested || process === undefined) return;
    killRequested = true;
    await process.kill();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    deadlineController.abort(new Error("Sandbox command timed out."));
    void requestKill().catch(() => undefined);
  }, input.timeoutMs);
  timer.unref?.();

  const signal = AbortSignal.any([input.abortSignal, deadlineController.signal]);
  try {
    process = await input.sandbox.spawn({
      command: input.command,
      workingDirectory: input.workingDirectory,
      abortSignal: signal,
    });
  } catch (cause) {
    clearTimeout(timer);
    if (timedOut) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: "Sandbox command timed out.",
        timedOut: true,
        outputLimited: false,
        durationMs: Date.now() - startedAt,
      };
    }
    throw cause;
  }
  if (timedOut || signal.aborted) await requestKill().catch(() => undefined);
  const abortListener = () => void requestKill().catch(() => undefined);
  signal.addEventListener("abort", abortListener, { once: true });

  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const budget: OutputBudget = { captured: 0, limited: false };

  const collect = (stream: ReadableStream<Uint8Array>, target: Uint8Array[]) =>
    collectBoundedStream({
      budget,
      maxOutputBytes: input.maxOutputBytes,
      onLimitExceeded: requestKill,
      stream,
      target,
    });

  const wait = Promise.resolve(process.wait());
  const settled = await Promise.allSettled([
    collect(process.stdout, stdout),
    collect(process.stderr, stderr),
    wait,
  ]);
  clearTimeout(timer);
  signal.removeEventListener("abort", abortListener);
  if (timedOut) await requestKill().catch(() => undefined);

  const waitResult = settled[2];
  const exitCode = waitResult?.status === "fulfilled" ? waitResult.value.exitCode : -1;

  const decodedStdout = decodeByteGroups(stdout);
  const boundedStdout = truncateUtf8(decodedStdout, input.maxOutputBytes);
  const stdoutBytes = new TextEncoder().encode(boundedStdout).byteLength;
  const decodedStderr = decodeByteGroups(stderr);
  const boundedStderr = truncateUtf8(
    decodedStderr,
    Math.max(0, input.maxOutputBytes - stdoutBytes),
  );
  const representationLimited = boundedStdout !== decodedStdout || boundedStderr !== decodedStderr;

  return {
    exitCode,
    stdout: boundedStdout,
    stderr: boundedStderr,
    timedOut,
    outputLimited: budget.limited || representationLimited,
    durationMs: Date.now() - startedAt,
  };
}
