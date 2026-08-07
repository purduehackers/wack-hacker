import * as path from "node:path";

import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { codeMutationApproval, decideCodeCapability } from "../../../lib/code-sandbox/policy.ts";
import {
  COMMAND_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_COMMAND_TIMEOUT_MS,
  MAX_FILE_BYTES,
  commandRefusal,
  confinedRepoPath,
  containsLikelySecret,
  isSensitivePath,
  relativeRepoPath,
  runBoundedCommand,
  sanitizeText,
  shellQuote,
} from "../../../lib/code-sandbox/safety.ts";
import { codeSessionDirectory, codeWorkspaceState } from "../../../lib/code-sandbox/state.ts";
import { guardToolExecution } from "../../../lib/core/serialization.ts";

const REPO_PATTERN = /^purduehackers\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/u;
const REF_PATTERN = /^(?![-./])(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}$/u;
const MAX_SEARCH_RESULTS = 200;

const checkoutInput = z.strictObject({
  repo: z.string().regex(REPO_PATTERN, "Repository must be a single purduehackers/<name> path."),
  ref: z
    .string()
    .regex(REF_PATTERN, "Git ref contains unsafe characters.")
    .optional()
    .describe("Optional public branch or tag to check out."),
});

const readInput = z.strictObject({
  path: z.string().min(1).max(2_000),
  offset: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1_000).default(200),
});

const globInput = z.strictObject({
  pattern: z.string().min(1).max(1_000),
  path: z.string().max(2_000).default("."),
  limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(100),
});

const grepInput = z.strictObject({
  pattern: z.string().min(1).max(2_000),
  path: z.string().max(2_000).default("."),
  glob: z.string().min(1).max(1_000).optional(),
  literal: z.boolean().default(false),
  ignoreCase: z.boolean().default(false),
  limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(100),
});

const executeInput = z.strictObject({
  command: z.string().min(1).max(20_000),
  cwd: z.string().max(2_000).default("."),
  timeoutMs: z.number().int().min(1_000).max(MAX_COMMAND_TIMEOUT_MS).default(COMMAND_TIMEOUT_MS),
});

const writeInput = z.strictObject({
  path: z.string().min(1).max(2_000),
  content: z.string().max(MAX_FILE_BYTES),
  overwrite: z.boolean().default(false),
});

const editInput = z.strictObject({
  path: z.string().min(1).max(2_000),
  oldString: z.string().min(1).max(MAX_FILE_BYTES),
  newString: z.string().max(MAX_FILE_BYTES),
  replaceAll: z.boolean().default(false),
});

const removeInput = z.strictObject({
  path: z.string().min(1).max(2_000),
  recursive: z.boolean().default(false),
});

function denied(reason?: string) {
  return {
    ok: false as const,
    error: { code: "policy_denied", message: reason ?? "Code capability denied." },
  };
}

function failed(code: string, message: string) {
  return { ok: false as const, error: { code, message } };
}

function safeCauseMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? sanitizeText(cause.message, 2_000).text : fallback;
}

/**
 * Step-scoped by design: Eve 0.29.5 only preserves dynamic approval callbacks
 * at this scope. Every executor is inline so its closure is replay-safe.
 */
export default defineDynamic({
  events: {
    // oxlint-disable-next-line oxclippy/too-many-lines -- Eve requires dynamic definitions and inline replay-safe executors in this resolver.
    "step.started": (_event, resolveContext) => {
      const current = resolveContext.session.auth.current;
      const workspace = codeWorkspaceState.get();

      // Publication is terminal: only code_post_finish remains replayable afterward.
      if (workspace.phase === "ready" && workspace.publication !== undefined) return undefined;

      if (workspace.phase !== "ready" || workspace.repoDir === undefined) {
        const checkoutPolicy = decideCodeCapability(current, "checkout_repository", "write");
        if (!checkoutPolicy.allowed) return undefined;

        return {
          checkout_repository: defineTool({
            description:
              "Check out one public purduehackers/<repo> into this Eve-owned sandbox. This is the only capability visible until a checkout succeeds. Requires the current admin's approval.",
            inputSchema: checkoutInput,
            approval: ({ session }) =>
              codeMutationApproval(session.auth.current, "checkout_repository", "write"),
            // oxlint-disable oxclippy/too-many-lines -- checkout stays inline so Eve can replay its executor.
            async execute({ repo, ref }, ctx) {
              return guardToolExecution(async () => {
                const permission = decideCodeCapability(
                  ctx.session.auth.current,
                  "checkout_repository",
                  "write",
                );
                if (!permission.allowed) return denied(permission.reason);

                const existingState = codeWorkspaceState.get();
                if (existingState.phase === "ready") {
                  return existingState.repo === repo
                    ? {
                        ok: true as const,
                        repo,
                        directory: existingState.repoDir,
                        reused: true,
                      }
                    : failed(
                        "workspace_already_bound",
                        "This delegated session is already bound to a different repository.",
                      );
                }

                const sandbox = await ctx.getSandbox();
                const repoName = repo.slice("purduehackers/".length);
                const sessionDirectory = codeSessionDirectory(sandbox);
                const repositoriesDir = sandbox.resolvePath(`${sessionDirectory}/repositories`);
                const repoDirRelative = `${sessionDirectory}/repositories/${repoName}`;
                const repoDir = sandbox.resolvePath(repoDirRelative);
                const origin = `https://github.com/${repo}.git`;

                const probe = await runBoundedCommand({
                  sandbox,
                  command: `git -C ${shellQuote(repoDir)} rev-parse --is-inside-work-tree && git -C ${shellQuote(repoDir)} remote get-url origin`,
                  workingDirectory: sandbox.resolvePath("."),
                  timeoutMs: 10_000,
                  maxOutputBytes: 4_000,
                  abortSignal: ctx.abortSignal,
                });
                const probeLines = probe.stdout.trim().split("\n");
                if (probe.exitCode === 0 && probeLines[0] === "true" && probeLines[1] === origin) {
                  const head = await runBoundedCommand({
                    sandbox,
                    command: `git -C ${shellQuote(repoDir)} rev-parse HEAD`,
                    workingDirectory: sandbox.resolvePath("."),
                    timeoutMs: 10_000,
                    maxOutputBytes: 1_000,
                    abortSignal: ctx.abortSignal,
                  });
                  const checkoutSha = head.stdout.trim();
                  if (head.exitCode !== 0 || !/^[a-f0-9]{40,64}$/u.test(checkoutSha)) {
                    return failed("checkout_invalid", "The existing checkout has no valid HEAD.");
                  }
                  codeWorkspaceState.update(() => ({
                    phase: "ready",
                    checkoutSha,
                    repo,
                    repoDir: repoDirRelative,
                  }));
                  return { ok: true as const, repo, directory: repoDirRelative, reused: true };
                }

                const destinationCheck = await runBoundedCommand({
                  sandbox,
                  command: `test ! -e ${shellQuote(repoDir)}`,
                  workingDirectory: sandbox.resolvePath("."),
                  timeoutMs: 5_000,
                  maxOutputBytes: 1_000,
                  abortSignal: ctx.abortSignal,
                });
                if (destinationCheck.exitCode !== 0) {
                  return failed(
                    "checkout_conflict",
                    "The repository destination exists but is not the requested verified checkout.",
                  );
                }

                const branch = ref === undefined ? "" : ` --branch ${shellQuote(ref)}`;
                const checkout = await runBoundedCommand({
                  sandbox,
                  command: `mkdir -p ${shellQuote(repositoriesDir)} && git clone --depth 1${branch} -- ${shellQuote(origin)} ${shellQuote(repoDir)}`,
                  workingDirectory: sandbox.resolvePath("."),
                  timeoutMs: MAX_COMMAND_TIMEOUT_MS,
                  maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
                  abortSignal: ctx.abortSignal,
                });
                const stdout = sanitizeText(checkout.stdout);
                const stderr = sanitizeText(checkout.stderr);
                if (checkout.exitCode !== 0 || checkout.timedOut || checkout.outputLimited) {
                  return {
                    ok: false as const,
                    error: {
                      code: checkout.timedOut
                        ? "checkout_timeout"
                        : checkout.outputLimited
                          ? "checkout_output_limit"
                          : "checkout_failed",
                      message: "The public repository checkout did not complete.",
                    },
                    exitCode: checkout.exitCode,
                    stdout: stdout.text,
                    stderr: stderr.text,
                    redacted: stdout.redacted || stderr.redacted,
                    truncated: stdout.truncated || stderr.truncated || checkout.outputLimited,
                  };
                }

                const head = await runBoundedCommand({
                  sandbox,
                  command: `git -C ${shellQuote(repoDir)} rev-parse HEAD`,
                  workingDirectory: sandbox.resolvePath("."),
                  timeoutMs: 10_000,
                  maxOutputBytes: 1_000,
                  abortSignal: ctx.abortSignal,
                });
                const checkoutSha = head.stdout.trim();
                if (head.exitCode !== 0 || !/^[a-f0-9]{40,64}$/u.test(checkoutSha)) {
                  return failed("checkout_invalid", "The new checkout has no valid HEAD.");
                }
                codeWorkspaceState.update(() => ({
                  phase: "ready",
                  checkoutSha,
                  repo,
                  repoDir: repoDirRelative,
                }));
                return {
                  ok: true as const,
                  repo,
                  directory: repoDirRelative,
                  reused: false,
                  durationMs: checkout.durationMs,
                };
              });
            },
            // oxlint-enable oxclippy/too-many-lines
          }),
        };
      }

      const readPolicy = decideCodeCapability(current, "code_workspace_read", "read");
      if (!readPolicy.allowed) return undefined;
      const writePolicy = decideCodeCapability(current, "code_workspace_mutate", "write");
      const checkedOutRepoDir = workspace.repoDir;
      const checkedOutRepo = workspace.repo;

      const tools = {
        read_file: defineTool({
          description:
            "Read a bounded line range from a non-secret text file in the checked-out repository. Paths are confined lexically and through symlinks.",
          inputSchema: readInput,
          async execute({ path: requestedPath, offset, limit }, ctx) {
            return guardToolExecution(async () => {
              const permission = decideCodeCapability(
                ctx.session.auth.current,
                "read_file",
                "read",
              );
              if (!permission.allowed) return denied(permission.reason);

              try {
                const sandbox = await ctx.getSandbox();
                const repoRoot = sandbox.resolvePath(checkedOutRepoDir);
                const absolute = await confinedRepoPath(
                  sandbox,
                  repoRoot,
                  requestedPath,
                  ctx.abortSignal,
                );
                const size = await runBoundedCommand({
                  sandbox,
                  command: `wc -c < ${shellQuote(absolute)}`,
                  workingDirectory: repoRoot,
                  timeoutMs: 10_000,
                  maxOutputBytes: 1_000,
                  abortSignal: ctx.abortSignal,
                });
                const bytes = Number.parseInt(size.stdout.trim(), 10);
                if (size.exitCode !== 0 || !Number.isSafeInteger(bytes)) {
                  return failed("read_failed", "The requested file could not be inspected.");
                }
                if (bytes > MAX_FILE_BYTES) {
                  return failed(
                    "file_too_large",
                    `File exceeds the ${MAX_FILE_BYTES} byte read limit.`,
                  );
                }

                const content = await sandbox.readTextFile({
                  path: absolute,
                  startLine: offset,
                  endLine: offset + limit - 1,
                  abortSignal: ctx.abortSignal,
                });
                if (content === null) return failed("not_found", "File was not found.");
                if (content.includes("\0")) {
                  return failed("binary_file", "Binary files are not returned as text.");
                }
                const safe = sanitizeText(content);
                const rendered = safe.text
                  .split("\n")
                  .map((line, index) => `${offset + index}: ${line}`)
                  .join("\n");
                return {
                  ok: true as const,
                  repo: checkedOutRepo,
                  path: relativeRepoPath(repoRoot, absolute),
                  content: rendered,
                  startLine: offset,
                  endLine: offset + Math.max(0, safe.text.split("\n").length - 1),
                  redacted: safe.redacted,
                  truncated: safe.truncated,
                };
              } catch (cause) {
                return failed("read_refused", safeCauseMessage(cause, "File read was refused."));
              }
            });
          },
        }),

        glob: defineTool({
          description:
            "Find repository files by glob pattern with bounded results. Secret-bearing paths and .git internals are omitted.",
          inputSchema: globInput,
          async execute({ pattern, path: requestedPath, limit }, ctx) {
            return guardToolExecution(async () => {
              const permission = decideCodeCapability(ctx.session.auth.current, "glob", "read");
              if (!permission.allowed) return denied(permission.reason);

              try {
                const sandbox = await ctx.getSandbox();
                const repoRoot = sandbox.resolvePath(checkedOutRepoDir);
                const searchRoot = await confinedRepoPath(
                  sandbox,
                  repoRoot,
                  requestedPath,
                  ctx.abortSignal,
                );
                const command = `if command -v rg >/dev/null 2>&1; then rg --files --hidden --glob '!.git/*' --glob ${shellQuote(pattern)} -- ${shellQuote(searchRoot)}; else find ${shellQuote(searchRoot)} -type f -not -path '*/.git/*' -name ${shellQuote(pattern.replaceAll("**", "*"))}; fi | head -n ${limit + 1}`;
                const result = await runBoundedCommand({
                  sandbox,
                  command,
                  workingDirectory: repoRoot,
                  timeoutMs: 30_000,
                  maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
                  abortSignal: ctx.abortSignal,
                });
                if (result.exitCode !== 0 || result.timedOut || result.outputLimited) {
                  return failed("glob_failed", "Bounded file discovery did not complete.");
                }
                const all = result.stdout
                  .split("\n")
                  .filter(Boolean)
                  .map((entry) => path.posix.relative(repoRoot, entry))
                  .filter(
                    (entry) => entry !== "" && !entry.startsWith("../") && !isSensitivePath(entry),
                  );
                const files = all.slice(0, limit);
                return {
                  ok: true as const,
                  repo: checkedOutRepo,
                  pattern,
                  files,
                  count: files.length,
                  truncated: all.length > limit,
                };
              } catch (cause) {
                return failed(
                  "glob_refused",
                  safeCauseMessage(cause, "File discovery was refused."),
                );
              }
            });
          },
        }),

        grep: defineTool({
          description:
            "Search non-secret repository files with bounded output. Matches are redacted before they leave the sandbox boundary.",
          inputSchema: grepInput,
          async execute({ pattern, path: requestedPath, glob, literal, ignoreCase, limit }, ctx) {
            return guardToolExecution(async () => {
              const permission = decideCodeCapability(ctx.session.auth.current, "grep", "read");
              if (!permission.allowed) return denied(permission.reason);
              if (containsLikelySecret(pattern)) {
                return failed("secret_input", "Searching for a supplied secret value is refused.");
              }

              try {
                const sandbox = await ctx.getSandbox();
                const repoRoot = sandbox.resolvePath(checkedOutRepoDir);
                const searchRoot = await confinedRepoPath(
                  sandbox,
                  repoRoot,
                  requestedPath,
                  ctx.abortSignal,
                );
                const rgFlags = [
                  "--line-number",
                  "--color=never",
                  "--hidden",
                  "--glob '!.git/*'",
                  "--glob '!.env'",
                  "--glob '!.env.*'",
                  "--glob '!.npmrc'",
                  "--glob '!.netrc'",
                ];
                if (literal) rgFlags.push("--fixed-strings");
                if (ignoreCase) rgFlags.push("--ignore-case");
                if (glob !== undefined) rgFlags.push(`--glob ${shellQuote(glob)}`);
                const grepFlags = ["-r", "-n", "--color=never", "--exclude-dir=.git"];
                grepFlags.push(literal ? "-F" : "-E");
                if (ignoreCase) grepFlags.push("-i");
                if (glob !== undefined) grepFlags.push(`--include=${shellQuote(glob)}`);
                const command = `if command -v rg >/dev/null 2>&1; then rg ${rgFlags.join(" ")} -- ${shellQuote(pattern)} ${shellQuote(searchRoot)}; else grep ${grepFlags.join(" ")} -- ${shellQuote(pattern)} ${shellQuote(searchRoot)}; fi | head -n ${limit + 1}`;
                const result = await runBoundedCommand({
                  sandbox,
                  command,
                  workingDirectory: repoRoot,
                  timeoutMs: 30_000,
                  maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
                  abortSignal: ctx.abortSignal,
                });
                if (
                  (result.exitCode !== 0 && result.exitCode !== 1) ||
                  result.timedOut ||
                  result.outputLimited
                ) {
                  return failed("grep_failed", "Bounded content search did not complete.");
                }
                const lines = result.stdout.split("\n").filter(Boolean);
                const safe = sanitizeText(lines.slice(0, limit).join("\n"));
                return {
                  ok: true as const,
                  repo: checkedOutRepo,
                  pattern,
                  content: safe.text,
                  matchCount: Math.min(lines.length, limit),
                  redacted: safe.redacted,
                  truncated: lines.length > limit || safe.truncated,
                };
              } catch (cause) {
                return failed(
                  "grep_refused",
                  safeCauseMessage(cause, "Content search was refused."),
                );
              }
            });
          },
        }),
      };

      if (!writePolicy.allowed) return tools;

      return {
        ...tools,
        bash: defineTool({
          description:
            "Run a non-interactive command in the checked-out repository with no env forwarding. Every call requires current-admin approval, has a 5 minute maximum, a 32 KB combined output cap, secret redaction, and destructive/remote actions are refused.",
          inputSchema: executeInput,
          approval: ({ session }) => codeMutationApproval(session.auth.current, "bash", "write"),
          async execute({ command, cwd, timeoutMs }, ctx) {
            return guardToolExecution(async () => {
              const permission = decideCodeCapability(ctx.session.auth.current, "bash", "write");
              if (!permission.allowed) return denied(permission.reason);
              const refusal = commandRefusal(command);
              if (refusal !== undefined) return failed("command_refused", refusal);

              try {
                const sandbox = await ctx.getSandbox();
                const repoRoot = sandbox.resolvePath(checkedOutRepoDir);
                const workingDirectory = await confinedRepoPath(
                  sandbox,
                  repoRoot,
                  cwd,
                  ctx.abortSignal,
                );
                const pathRefusal = commandRefusal(command, { repoRoot, workingDirectory });
                if (pathRefusal !== undefined) return failed("command_refused", pathRefusal);
                const result = await runBoundedCommand({
                  sandbox,
                  command,
                  workingDirectory,
                  timeoutMs,
                  maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
                  abortSignal: ctx.abortSignal,
                });
                const stdout = sanitizeText(result.stdout);
                const stderr = sanitizeText(result.stderr);
                return {
                  ok: !result.timedOut && !result.outputLimited && result.exitCode === 0,
                  repo: checkedOutRepo,
                  command,
                  cwd: relativeRepoPath(repoRoot, workingDirectory),
                  exitCode: result.exitCode,
                  stdout: stdout.text,
                  stderr: stderr.text,
                  durationMs: result.durationMs,
                  timedOut: result.timedOut,
                  outputLimited: result.outputLimited,
                  redacted: stdout.redacted || stderr.redacted,
                  truncated: stdout.truncated || stderr.truncated || result.outputLimited,
                };
              } catch (cause) {
                return failed(
                  "command_failed",
                  safeCauseMessage(cause, "Command execution failed."),
                );
              }
            });
          },
        }),

        write_file: defineTool({
          description:
            "Create a bounded non-secret text file in the checked-out repository. Overwriting must be explicit. Requires current-admin approval.",
          inputSchema: writeInput,
          approval: ({ session }) =>
            codeMutationApproval(session.auth.current, "write_file", "write"),
          async execute({ path: requestedPath, content, overwrite }, ctx) {
            return guardToolExecution(async () => {
              const permission = decideCodeCapability(
                ctx.session.auth.current,
                "write_file",
                "write",
              );
              if (!permission.allowed) return denied(permission.reason);
              if (containsLikelySecret(content)) {
                return failed("secret_input", "Writing likely secret material is refused.");
              }
              const contentBytes = new TextEncoder().encode(content).byteLength;
              if (contentBytes > MAX_FILE_BYTES) {
                return failed("file_too_large", "File content exceeds the byte limit.");
              }

              try {
                const sandbox = await ctx.getSandbox();
                const repoRoot = sandbox.resolvePath(checkedOutRepoDir);
                const absolute = await confinedRepoPath(
                  sandbox,
                  repoRoot,
                  requestedPath,
                  ctx.abortSignal,
                );
                const exists = await runBoundedCommand({
                  sandbox,
                  command: `test -e ${shellQuote(absolute)}`,
                  workingDirectory: repoRoot,
                  timeoutMs: 5_000,
                  maxOutputBytes: 1_000,
                  abortSignal: ctx.abortSignal,
                });
                if (exists.exitCode === 0 && !overwrite) {
                  return failed(
                    "overwrite_not_confirmed",
                    "File exists; use edit_file or explicitly set overwrite=true.",
                  );
                }
                await sandbox.writeTextFile({
                  path: absolute,
                  content,
                  abortSignal: ctx.abortSignal,
                });
                return {
                  ok: true as const,
                  repo: checkedOutRepo,
                  path: relativeRepoPath(repoRoot, absolute),
                  bytes: contentBytes,
                  created: exists.exitCode !== 0,
                };
              } catch (cause) {
                return failed("write_refused", safeCauseMessage(cause, "File write was refused."));
              }
            });
          },
        }),

        edit_file: defineTool({
          description:
            "Replace an exact string in a bounded non-secret repository file. The old string must be unique unless replaceAll is true. Requires current-admin approval.",
          inputSchema: editInput,
          approval: ({ session }) =>
            codeMutationApproval(session.auth.current, "edit_file", "write"),
          async execute({ path: requestedPath, oldString, newString, replaceAll }, ctx) {
            return guardToolExecution(async () => {
              const permission = decideCodeCapability(
                ctx.session.auth.current,
                "edit_file",
                "write",
              );
              if (!permission.allowed) return denied(permission.reason);
              if (containsLikelySecret(oldString) || containsLikelySecret(newString)) {
                return failed("secret_input", "Editing with likely secret material is refused.");
              }
              if (oldString === newString) {
                return failed("no_change", "oldString and newString are identical.");
              }

              try {
                const sandbox = await ctx.getSandbox();
                const repoRoot = sandbox.resolvePath(checkedOutRepoDir);
                const absolute = await confinedRepoPath(
                  sandbox,
                  repoRoot,
                  requestedPath,
                  ctx.abortSignal,
                );
                const size = await runBoundedCommand({
                  sandbox,
                  command: `wc -c < ${shellQuote(absolute)}`,
                  workingDirectory: repoRoot,
                  timeoutMs: 10_000,
                  maxOutputBytes: 1_000,
                  abortSignal: ctx.abortSignal,
                });
                const bytes = Number.parseInt(size.stdout.trim(), 10);
                if (size.exitCode !== 0 || !Number.isSafeInteger(bytes)) {
                  return failed("edit_failed", "The requested file could not be inspected.");
                }
                if (bytes > MAX_FILE_BYTES) {
                  return failed(
                    "file_too_large",
                    `File exceeds the ${MAX_FILE_BYTES} byte edit limit.`,
                  );
                }

                const content = await sandbox.readTextFile({
                  path: absolute,
                  abortSignal: ctx.abortSignal,
                });
                if (content === null) return failed("not_found", "File was not found.");
                const occurrences = content.split(oldString).length - 1;
                if (occurrences === 0) return failed("not_found", "oldString was not found.");
                if (!replaceAll && occurrences !== 1) {
                  return failed(
                    "ambiguous_edit",
                    `oldString occurs ${occurrences} times; add context or set replaceAll=true.`,
                  );
                }
                const updated = replaceAll
                  ? content.split(oldString).join(newString)
                  : content.replace(oldString, newString);
                if (new TextEncoder().encode(updated).byteLength > MAX_FILE_BYTES) {
                  return failed("file_too_large", "Edited file would exceed the file size limit.");
                }
                await sandbox.writeTextFile({
                  path: absolute,
                  content: updated,
                  abortSignal: ctx.abortSignal,
                });
                return {
                  ok: true as const,
                  repo: checkedOutRepo,
                  path: relativeRepoPath(repoRoot, absolute),
                  replacements: replaceAll ? occurrences : 1,
                };
              } catch (cause) {
                return failed("edit_refused", safeCauseMessage(cause, "File edit was refused."));
              }
            });
          },
        }),

        remove_path: defineTool({
          description:
            "Remove one targeted repository path. The repository root and .git are immutable, and directory recursion must be explicit. This destructive action requires current-admin approval.",
          inputSchema: removeInput,
          approval: ({ session }) =>
            codeMutationApproval(session.auth.current, "remove_path", "destructive"),
          async execute({ path: requestedPath, recursive }, ctx) {
            return guardToolExecution(async () => {
              const permission = decideCodeCapability(
                ctx.session.auth.current,
                "remove_path",
                "destructive",
              );
              if (!permission.allowed) return denied(permission.reason);

              try {
                const sandbox = await ctx.getSandbox();
                const repoRoot = sandbox.resolvePath(checkedOutRepoDir);
                const absolute = await confinedRepoPath(
                  sandbox,
                  repoRoot,
                  requestedPath,
                  ctx.abortSignal,
                );
                const relative = relativeRepoPath(repoRoot, absolute);
                if (relative === "." || relative === ".git" || relative.startsWith(".git/")) {
                  return failed("protected_path", "The repository root and .git are protected.");
                }
                await sandbox.removePath({
                  path: absolute,
                  recursive,
                  force: false,
                  abortSignal: ctx.abortSignal,
                });
                return { ok: true as const, repo: checkedOutRepo, path: relative, recursive };
              } catch (cause) {
                return failed(
                  "remove_refused",
                  safeCauseMessage(cause, "Path removal was refused."),
                );
              }
            });
          },
        }),
      };
    },
  },
});
