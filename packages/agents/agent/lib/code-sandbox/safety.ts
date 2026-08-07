import * as path from "node:path";

import type { SandboxSession } from "eve/sandbox";

export const COMMAND_TIMEOUT_MS = 120_000;
export const MAX_COMMAND_TIMEOUT_MS = 5 * 60_000;
export const MAX_COMMAND_OUTPUT_BYTES = 32_000;
export const MAX_FILE_BYTES = 512_000;
export const MAX_TOOL_TEXT_BYTES = 64_000;

const SECRET_VALUE =
  /(?:gh[oprsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})/u;
const SECRET_ASSIGNMENT =
  /(?:token|secret|password|passwd|api[_-]?key|authorization|private[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/iu;
const SECRET_VARIABLE =
  /(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|BASH_ENV|GIT_ASKPASS|SSH_ASKPASS)/iu;
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
const SECRET_OS_PATH =
  /(?:^|\/)(?:proc|sys)(?:\/|$)|^\/(?:etc|home|root)(?:\/|$)|^\/(?:run|var\/run)\/secrets(?:\/|$)/u;
const HIDDEN_PATH_GLOB = /(?:^|\/)\.[^/]*[*?[]/u;

const ALWAYS_REFUSED_WORDS = new Map<string, string>([
  ["rm", "shell deletion is disabled; use remove_path"],
  ["sudo", "privilege escalation is not allowed"],
  ["mkfs", "host-level filesystem operations are not allowed"],
  ["mount", "host-level filesystem operations are not allowed"],
  ["umount", "host-level filesystem operations are not allowed"],
  ["chown", "host-level filesystem operations are not allowed"],
]);
const REFUSED_BUILTINS = new Set([
  ".",
  "alias",
  "builtin",
  "command",
  "compgen",
  "complete",
  "declare",
  "enable",
  "env",
  "eval",
  "exec",
  "export",
  "hash",
  "popd",
  "printenv",
  "pushd",
  "read",
  "readonly",
  "set",
  "source",
  "trap",
  "typeset",
  "unset",
]);
const REFUSED_CONTROL_WORDS = new Set([
  "!",
  "case",
  "coproc",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "select",
  "then",
  "until",
  "while",
]);
const REFUSED_GIT_SUBCOMMANDS = new Set([
  "clean",
  "clone",
  "config",
  "fetch",
  "ls-remote",
  "pull",
  "push",
  "receive-pack",
  "remote",
  "send-pack",
  "submodule",
]);
const SHELL_INTERPRETERS = new Set(["bash", "dash", "fish", "ksh", "sh", "zsh"]);
const COMMAND_OPERATORS = new Set(["&&", ";", "\n", "|", "||"]);

interface ShellWord {
  readonly kind: "word";
  readonly value: string;
}

interface ShellOperator {
  readonly kind: "operator";
  readonly value: string;
}

type ShellToken = ShellOperator | ShellWord;

interface ShellLexResult {
  readonly tokens: readonly ShellToken[];
  readonly refusal?: string;
}

// oxlint-disable-next-line oxclippy/too-many-lines, oxclippy/cognitive-complexity -- the lexer keeps quote and escape state in one auditable pass.
function shellLex(command: string): ShellLexResult {
  const tokens: ShellToken[] = [];
  let word = "";
  let quote: "double" | "single" | undefined;
  let wordStarted = false;

  const flushWord = () => {
    if (!wordStarted) return;
    tokens.push({ kind: "word", value: word });
    word = "";
    wordStarted = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";

    if (quote === "single") {
      if (character === "'") quote = undefined;
      else word += character;
      continue;
    }
    if (character === "`") {
      return { tokens, refusal: "backtick command substitution is not allowed" };
    }
    if (character === "$" && command[index + 1] === "(") {
      return { tokens, refusal: "command and arithmetic substitution are not allowed" };
    }
    if (character === "$") {
      return { tokens, refusal: "shell parameter and ANSI-C expansion is not allowed" };
    }

    if (quote === "double") {
      if (character === '"') {
        quote = undefined;
      } else if (character === "\\") {
        const next = command[index + 1];
        if (next === undefined) return { tokens, refusal: "command ends in an escape" };
        word += next;
        index += 1;
      } else {
        word += character;
      }
      continue;
    }

    if (character === "'") {
      quote = "single";
      wordStarted = true;
      continue;
    }
    if (character === '"') {
      quote = "double";
      wordStarted = true;
      continue;
    }
    if (character === "\\") {
      const next = command[index + 1];
      if (next === undefined) return { tokens, refusal: "command ends in an escape" };
      if (next !== "\n") {
        word += next;
        wordStarted = true;
      }
      index += 1;
      continue;
    }
    if (character === "#" && !wordStarted) {
      while (index + 1 < command.length && command[index + 1] !== "\n") index += 1;
      continue;
    }
    if (/\s/u.test(character) && character !== "\n") {
      flushWord();
      continue;
    }
    if (character === "2" && !wordStarted && command.slice(index, index + 4) === "2>&1") {
      index += 3;
      continue;
    }
    if (character === "1" && !wordStarted && command.slice(index, index + 4) === "1>&2") {
      index += 3;
      continue;
    }
    if (character === "<" || character === ">") {
      return { tokens, refusal: "file and input redirection is not allowed" };
    }
    if (character === "(" || character === ")" || character === "{" || character === "}") {
      return { tokens, refusal: "shell grouping and functions are not allowed" };
    }
    if (character === "&") {
      flushWord();
      if (command[index + 1] === "&") {
        tokens.push({ kind: "operator", value: "&&" });
        index += 1;
        continue;
      }
      return { tokens, refusal: "background commands are not allowed" };
    }
    if (character === "|") {
      flushWord();
      if (command[index + 1] === "|") {
        tokens.push({ kind: "operator", value: "||" });
        index += 1;
      } else {
        tokens.push({ kind: "operator", value: "|" });
      }
      continue;
    }
    if (character === ";" || character === "\n") {
      flushWord();
      tokens.push({ kind: "operator", value: character });
      continue;
    }

    word += character;
    wordStarted = true;
  }

  if (quote !== undefined) return { tokens, refusal: "command contains an unterminated quote" };
  flushWord();
  return { tokens };
}

function executableName(value: string): string {
  return path.posix.basename(value).toLowerCase();
}

function assignmentName(value: string): string | undefined {
  return /^([A-Za-z_][A-Za-z0-9_]*)=/u.exec(value)?.[1];
}

function sensitiveWordPath(value: string): boolean {
  if (value.startsWith("~") || SECRET_OS_PATH.test(value.replaceAll("\\", "/"))) return true;
  return value
    .split(/[=:]/u)
    .some((candidate) => isSensitivePath(candidate) || HIDDEN_PATH_GLOB.test(candidate));
}

function gitSubcommand(commandWords: readonly string[], commandIndex: number): string | undefined {
  let index = commandIndex + 1;
  while (index < commandWords.length) {
    const candidate = commandWords[index] ?? "";
    if (candidate === "-C" || candidate === "--git-dir" || candidate === "--work-tree") {
      index += 2;
    } else if (candidate === "-c" || candidate.startsWith("--config-env=")) {
      return "config";
    } else if (candidate.startsWith("-")) {
      index += 1;
    } else {
      return candidate.toLowerCase();
    }
  }
  return undefined;
}

function shellInterpreterRefusal(argumentsAfterCommand: readonly string[]): string | undefined {
  let scriptIndex = 0;
  while (scriptIndex < argumentsAfterCommand.length) {
    const argument = argumentsAfterCommand[scriptIndex] ?? "";
    if (argument === "--") {
      scriptIndex += 1;
      break;
    }
    if (!argument.startsWith("-")) break;
    if (!/^-[eux]+$/u.test(argument)) {
      return "nested shell options that evaluate commands or stdin are not allowed";
    }
    scriptIndex += 1;
  }
  const script = argumentsAfterCommand[scriptIndex];
  if (
    script === undefined ||
    script === "-" ||
    script === "/dev/stdin" ||
    script.startsWith("/dev/fd/")
  ) {
    return "nested shells must execute an explicit repository script";
  }
  return undefined;
}

function withoutOptionMarker(arguments_: readonly string[]): readonly string[] {
  return arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
}

function wrapperRefusal(
  executable: string,
  argumentsAfterCommand: readonly string[],
): string | undefined {
  if (executable === "time") {
    const afterPortableFlag =
      argumentsAfterCommand[0] === "-p" ? argumentsAfterCommand.slice(1) : argumentsAfterCommand;
    return simpleCommandRefusal(withoutOptionMarker(afterPortableFlag));
  }
  if (executable === "nohup") {
    return simpleCommandRefusal(withoutOptionMarker(argumentsAfterCommand));
  }
  if (executable === "timeout") {
    if (argumentsAfterCommand[0]?.startsWith("-")) {
      return "timeout options are not allowed";
    }
    return simpleCommandRefusal(argumentsAfterCommand.slice(1));
  }
  if (executable === "nice") {
    const afterPriority =
      argumentsAfterCommand[0] === "-n" ? argumentsAfterCommand.slice(2) : argumentsAfterCommand;
    return simpleCommandRefusal(withoutOptionMarker(afterPriority));
  }
  return undefined;
}

// oxlint-disable-next-line oxclippy/cognitive-complexity -- each branch is a flat, fail-closed command policy rule.
function simpleCommandRefusal(commandWords: readonly string[]): string | undefined {
  if (commandWords.length === 0) return "empty shell command segments are not allowed";

  for (const word of commandWords) {
    const name = executableName(word);
    const refused = ALWAYS_REFUSED_WORDS.get(name);
    if (refused !== undefined) return refused;
    if (name.startsWith("mkfs.")) return "host-level filesystem operations are not allowed";
    if (sensitiveWordPath(word)) return "access to secret-bearing paths is not allowed";
  }

  let commandIndex = 0;
  while (commandIndex < commandWords.length) {
    const name = assignmentName(commandWords[commandIndex] ?? "");
    if (name === undefined) break;
    if (SECRET_VARIABLE.test(name)) {
      return "commands assigning security-sensitive environment variables are not allowed";
    }
    commandIndex += 1;
  }
  if (commandIndex === commandWords.length) {
    return "standalone shell variable assignments are not allowed";
  }

  const rawCommand = commandWords[commandIndex] ?? "";
  if (/[*?[{]/u.test(rawCommand)) return "wildcards in executable names are not allowed";
  const executable = executableName(rawCommand);
  if (REFUSED_BUILTINS.has(executable)) {
    return `the ${executable} shell builtin or environment command is not allowed`;
  }
  if (REFUSED_CONTROL_WORDS.has(executable)) return "shell control structures are not allowed";
  if (executable === "cd") {
    return "changing directories inside a command is disabled; use the cwd argument";
  }
  if (["busybox", "parallel", "xargs"].includes(executable)) {
    return "commands that dynamically select another executable are not allowed";
  }
  const argumentsAfterCommand = commandWords.slice(commandIndex + 1);
  if (SHELL_INTERPRETERS.has(executable)) {
    const shellRefusal = shellInterpreterRefusal(argumentsAfterCommand);
    if (shellRefusal !== undefined) return shellRefusal;
  }
  if (["nice", "nohup", "time", "timeout"].includes(executable)) {
    return wrapperRefusal(executable, argumentsAfterCommand);
  }
  if (
    executable === "find" &&
    argumentsAfterCommand.some((argument) =>
      ["-exec", "-execdir", "-ok", "-okdir"].includes(argument),
    )
  ) {
    return "find actions that dynamically execute another command are not allowed";
  }
  if (executable === "dd" && commandWords.some((argument) => argument.startsWith("of="))) {
    return "raw device/file overwrites are not allowed";
  }
  if (executable === "git") {
    const subcommand = gitSubcommand(commandWords, commandIndex);
    if (subcommand !== undefined && REFUSED_GIT_SUBCOMMANDS.has(subcommand)) {
      return "remote, transport-configuration, or destructive git operations are not allowed";
    }
    if (subcommand === "reset" && commandWords.includes("--hard")) {
      return "destructive git operations are not allowed";
    }
    if (subcommand === "checkout" && commandWords.includes("--")) {
      return "destructive git checkout operations are not allowed";
    }
  }
  if (
    ["bun", "cargo", "npm", "twine"].includes(executable) &&
    commandWords.slice(commandIndex + 1).some((argument) => argument.toLowerCase() === "publish")
  ) {
    return "publishing or changing remote systems is not allowed";
  }
  if (
    executable === "gh" &&
    commandWords
      .slice(commandIndex + 1)
      .some((argument) => ["issue", "pr", "release"].includes(argument))
  ) {
    return "publishing or changing remote systems is not allowed";
  }
  if (
    ["kubectl", "pulumi", "terraform", "vercel"].includes(executable) &&
    commandWords
      .slice(commandIndex + 1)
      .some((argument) => ["apply", "delete", "deploy", "destroy", "remove"].includes(argument))
  ) {
    return "deployment and infrastructure mutations are not allowed";
  }
  return undefined;
}

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

function commandArgumentPathRefusal(
  shellTokens: readonly ShellToken[],
  boundary: { readonly repoRoot: string; readonly workingDirectory: string },
): string | undefined {
  const root = path.posix.resolve(boundary.repoRoot);
  const workingDirectory = path.posix.resolve(boundary.workingDirectory);
  for (const token of shellTokens) {
    if (token.kind !== "word") continue;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(token.value)) continue;
    const equalsIndex = token.value.indexOf("=");
    const candidate = equalsIndex === -1 ? token.value : token.value.slice(equalsIndex + 1);
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(candidate) || candidate === "/dev/null") {
      continue;
    }
    const hasTraversal =
      candidate === ".." || candidate.startsWith("../") || candidate.includes("/../");
    if (!candidate.startsWith("/") && !hasTraversal) continue;
    const resolved = path.posix.resolve(workingDirectory, candidate);
    if (resolved !== root && !resolved.startsWith(`${root}/`)) {
      return "command path arguments must remain inside the checked-out repository";
    }
  }
  return undefined;
}

export function commandRefusal(
  command: string,
  boundary?: { readonly repoRoot: string; readonly workingDirectory: string },
): string | undefined {
  if (command.includes("\0")) return "NUL bytes are not allowed in commands";
  if (command.length > 20_000) return "command exceeds the 20,000 character limit";
  if (SECRET_VALUE.test(command) || SECRET_ASSIGNMENT.test(command)) {
    return "commands containing likely secrets are not allowed";
  }
  if (/:\(\)\s*\{/u.test(command)) return "fork bomb pattern detected";

  const lexed = shellLex(command);
  if (lexed.refusal !== undefined) return lexed.refusal;
  if (boundary !== undefined) {
    const pathRefusal = commandArgumentPathRefusal(lexed.tokens, boundary);
    if (pathRefusal !== undefined) return pathRefusal;
  }

  let words: string[] = [];
  for (const token of lexed.tokens) {
    if (token.kind === "word") {
      words.push(token.value);
      continue;
    }
    if (!COMMAND_OPERATORS.has(token.value)) return "unsupported shell operator";
    if (words.length === 0) return "empty shell command segments are not allowed";
    const refusal = simpleCommandRefusal(words);
    if (refusal !== undefined) return refusal;
    words = [];
  }
  return words.length === 0
    ? "empty shell command segments are not allowed"
    : simpleCommandRefusal(words);
}

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

export function lexicalRepoPath(repoRoot: string, requested: string): string {
  if (requested.includes("\0")) throw new Error("Paths may not contain NUL bytes.");
  const root = path.posix.resolve(repoRoot);
  const resolved = path.posix.resolve(root, requested === "" ? "." : requested);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new Error("Path resolves outside the checked-out repository.");
  }
  if (isSensitivePath(path.posix.relative(root, resolved))) {
    throw new Error("Access to secret-bearing credential or environment files is refused.");
  }
  return resolved;
}

export async function confinedRepoPath(
  sandbox: SandboxCommandRunner,
  repoRoot: string,
  requested: string,
  abortSignal: AbortSignal,
): Promise<string> {
  const lexical = lexicalRepoPath(repoRoot, requested);
  const root = path.posix.resolve(repoRoot);
  const canonical = await runBoundedCommand({
    sandbox,
    command: `realpath -zm -- ${shellQuote(root)} ${shellQuote(lexical)}`,
    workingDirectory: root,
    timeoutMs: 10_000,
    maxOutputBytes: 4_000,
    abortSignal,
  });
  if (canonical.exitCode !== 0 || canonical.timedOut || canonical.outputLimited) {
    throw new Error("Could not validate the requested path inside the repository.");
  }
  const canonicalPaths = canonical.stdout.split("\0");
  if (canonicalPaths.length !== 3 || canonicalPaths[2] !== "") {
    throw new Error("Could not validate the requested path inside the repository.");
  }
  const canonicalRoot = canonicalPaths[0] ?? "";
  const actual = canonicalPaths[1] ?? "";
  if (
    canonicalRoot === "" ||
    actual === "" ||
    (actual !== canonicalRoot && !actual.startsWith(`${canonicalRoot}/`))
  ) {
    throw new Error("Path crosses a symlink outside the checked-out repository.");
  }
  if (isSensitivePath(path.posix.relative(canonicalRoot, actual))) {
    throw new Error("Path resolves through a symlink to secret-bearing material.");
  }
  return lexical;
}

export function relativeRepoPath(repoRoot: string, absolute: string): string {
  return path.posix.relative(repoRoot, absolute) || ".";
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// oxlint-disable-next-line oxclippy/too-many-lines -- bounded stream collection, termination, and result assembly are one lifecycle.
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
  let capturedBytes = 0;
  let outputLimited = false;

  const collect = async (stream: ReadableStream<Uint8Array>, target: Uint8Array[]) => {
    const reader = stream.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const remaining = Math.max(0, input.maxOutputBytes - capturedBytes);
        if (remaining > 0) {
          const accepted =
            chunk.value.byteLength > remaining ? chunk.value.slice(0, remaining) : chunk.value;
          target.push(accepted);
          capturedBytes += accepted.byteLength;
        }
        if (chunk.value.byteLength > remaining) {
          outputLimited = true;
          await requestKill();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  };

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
  const decode = (byteGroups: Uint8Array[]): string => {
    const length = byteGroups.reduce((total, entry) => total + entry.byteLength, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const entry of byteGroups) {
      bytes.set(entry, offset);
      offset += entry.byteLength;
    }
    return new TextDecoder().decode(bytes);
  };

  const decodedStdout = decode(stdout);
  const boundedStdout = truncateUtf8(decodedStdout, input.maxOutputBytes);
  const stdoutBytes = new TextEncoder().encode(boundedStdout).byteLength;
  const decodedStderr = decode(stderr);
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
    outputLimited: outputLimited || representationLimited,
    durationMs: Date.now() - startedAt,
  };
}
