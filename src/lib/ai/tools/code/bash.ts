import { tool } from "ai";
import * as path from "node:path";
import { z } from "zod";

import { getSandboxContext, resolvePath } from "./utils.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;

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
  description: `Run a shell command in the sandbox (non-interactive bash). Returns stdout, stderr, exit code, and a truncation flag.

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
  execute: async ({ command, cwd, timeout_ms }, { experimental_context, abortSignal }) => {
    const { sandbox, repoDir } = getSandboxContext(experimental_context, "bash");

    for (const { pattern, reason } of REFUSAL_PATTERNS) {
      if (pattern.test(command)) {
        return JSON.stringify({
          refused: true,
          reason,
          command,
        });
      }
    }

    let resolvedCwd: string | undefined;
    if (cwd !== undefined) {
      try {
        resolvedCwd = resolvePath(repoDir, cwd);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    const result = await sandbox.exec(command, {
      cwd: resolvedCwd,
      timeoutMs: timeout_ms ?? DEFAULT_TIMEOUT_MS,
      signal: abortSignal,
    });

    return JSON.stringify({
      command,
      cwd: resolvedCwd ? path.relative(repoDir, resolvedCwd) || "." : ".",
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: result.truncated,
    });
  },
});
