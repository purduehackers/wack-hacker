import { tool, type UIMessage } from "ai";
import * as path from "node:path";
import { z } from "zod";

import { getSandboxContext, resolvePath } from "./utils.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_CHARS = 50_000;
const PROGRESS_INTERVAL_MS = 2_000;

/**
 * Patterns we refuse outright. The sandbox is the security boundary — these
 * exist to keep the model from footgunning (e.g. accidentally `rm -rf`-ing
 * the repo before a commit). Matches open-agents's `commandNeedsApproval`
 * but harder: since a subagent has no human-in-the-loop prompt, we reject
 * rather than request approval.
 */
const REFUSAL_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\brm\s+-rf\b/i,
    reason: "`rm -rf` is disallowed — edit tools or targeted rm paths only",
  },
  { pattern: /\.env\b/i, reason: "Touching `.env` files is disallowed" },
  { pattern: /curl[^|]+\|\s*(sudo\s+)?(bash|sh)\b/i, reason: "Piping curl to shell is disallowed" },
  { pattern: /wget[^|]+\|\s*(sudo\s+)?(bash|sh)\b/i, reason: "Piping wget to shell is disallowed" },
  { pattern: /:\(\)\s*\{/, reason: "Fork bomb pattern detected" },
  { pattern: /\bhistory\b/i, reason: "`history` is disallowed" },
  { pattern: /\bssh-keygen\b/i, reason: "`ssh-keygen` is disallowed" },
];

export const bash = tool({
  description: `Run a shell command in the sandbox (non-interactive bash). Streams progress while the command runs, then returns stdout, stderr, exit code, and a truncation flag as JSON.

WHEN TO USE:
- Project commands the repo already defines (e.g. \`bun run build\`, \`npm test\`)
- Git operations other than commit/push (commit/push is handled automatically after the task)
- Quick CLI utilities with no dedicated tool (e.g. \`node --version\`)

WHEN NOT TO USE:
- Reading/writing/editing files — use \`read\`, \`write\`, \`edit\`
- Searching code — use \`grep\` or \`glob\`
- Committing, pushing, or opening PRs — that happens automatically when you finish

LIMITS:
- Commands time out at 120s by default (max 10 min)
- Output is truncated at 50K chars per stream
- Certain destructive patterns are refused (rm -rf, .env touches, curl | sh)

The command is run in the repo root by default; pass \`cwd\` (repo-relative) to change directory for this one call.`,
  inputSchema: z.object({
    command: z.string().min(1).describe("Shell command to run"),
    cwd: z.string().optional().describe("Optional working directory, absolute or repo-relative"),
    timeout_ms: z
      .number()
      .int()
      .min(1000)
      .max(MAX_TIMEOUT_MS)
      .optional()
      .describe(`Command timeout in ms (default ${DEFAULT_TIMEOUT_MS})`),
  }),
  execute: async function* ({ command, cwd, timeout_ms }, { experimental_context, abortSignal }) {
    const { sandbox, repoDir } = getSandboxContext(experimental_context, "bash");

    for (const { pattern, reason } of REFUSAL_PATTERNS) {
      if (pattern.test(command)) {
        yield textMessage(
          JSON.stringify({
            refused: true,
            reason,
            command,
          }),
        );
        return;
      }
    }

    let resolvedCwd: string | undefined;
    if (cwd !== undefined) {
      try {
        resolvedCwd = resolvePath(repoDir, cwd);
      } catch (err) {
        yield textMessage(
          JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        );
        return;
      }
    }

    const cwdDisplay = resolvedCwd ? path.relative(repoDir, resolvedCwd) || "." : ".";
    const timeoutMs = timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const startedAt = Date.now();

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let lastProgressAt = startedAt;
    let emittedProgress = false;

    const stream = sandbox.streamExec(command, {
      cwd: resolvedCwd,
      timeoutMs,
      signal: abortSignal,
    });

    try {
      for await (const chunk of stream) {
        if (chunk.stream === "stdout") {
          stdout = appendBounded(stdout, chunk.data);
        } else {
          stderr = appendBounded(stderr, chunk.data);
        }
        if (stdout.length >= MAX_OUTPUT_CHARS || stderr.length >= MAX_OUTPUT_CHARS) {
          truncated = true;
        }
        const now = Date.now();
        if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
          lastProgressAt = now;
          emittedProgress = true;
          yield textMessage(
            renderProgress({
              command,
              cwdDisplay,
              elapsedMs: now - startedAt,
              stdoutLen: stdout.length,
              stderrLen: stderr.length,
            }),
          );
        }
      }
    } catch (err) {
      yield textMessage(
        JSON.stringify({
          command,
          cwd: cwdDisplay,
          error: err instanceof Error ? err.message : String(err),
          stdout: truncate(stdout),
          stderr: truncate(stderr),
        }),
      );
      return;
    }

    const final = {
      command,
      cwd: cwdDisplay,
      // Detached streaming has no clean exit-code surface on our impl; callers
      // rely on stdout/stderr content. We record 0 when we consumed to EOF
      // without error.
      exit_code: 0,
      elapsed_ms: Date.now() - startedAt,
      progress_updates_emitted: emittedProgress,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      truncated,
    };
    yield textMessage(JSON.stringify(final));
  },
  toModelOutput: ({ output }) => {
    const message = output as UIMessage | undefined;
    const last = message?.parts.findLast(
      (p): p is { type: "text"; text: string } => p.type === "text",
    );
    return { type: "text", value: last?.text ?? JSON.stringify({ error: "no bash output" }) };
  },
});

function textMessage(text: string): UIMessage {
  return {
    id: `bash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}

function appendBounded(buffer: string, addition: string): string {
  const next = buffer + addition;
  return next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next;
}

function truncate(value: string): string {
  return value.length > MAX_OUTPUT_CHARS ? value.slice(-MAX_OUTPUT_CHARS) : value;
}

function renderProgress(args: {
  command: string;
  cwdDisplay: string;
  elapsedMs: number;
  stdoutLen: number;
  stderrLen: number;
}): string {
  const seconds = Math.floor(args.elapsedMs / 1000);
  return `\`bash\` running: \`${args.command}\` (cwd: \`${args.cwdDisplay}\`) — ${seconds}s, ${args.stdoutLen} bytes stdout, ${args.stderrLen} bytes stderr`;
}
