import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, resolvePath } from "./utils.ts";

const MAX_RESULTS = 500;

export const glob = tool({
  description: `Find files by glob pattern (uses \`rg --files --glob\`). Returns an array of repo-relative paths.

Use this for "where is X?" discovery. Prefer \`grep\` when you need to search file *contents* rather than names.`,
  inputSchema: z.object({
    pattern: z.string().min(1).describe(`Glob pattern, e.g. "src/**/*.ts" or "*.md"`),
    path: z.string().default(".").describe("Directory to search in (absolute or repo-relative)"),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(MAX_RESULTS)
      .default(100)
      .describe("Stop after this many results"),
  }),
  execute: async (
    { pattern, path: userPath, max_results },
    { experimental_context, abortSignal },
  ) => {
    const { sandbox, repoDir } = getSandboxContext(experimental_context, "glob");
    let absolute: string;
    try {
      absolute = resolvePath(repoDir, userPath);
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }

    const command = `rg --files --glob ${shellQuote(pattern)} ${shellQuote(absolute)} | head -n ${max_results + 1}`;
    const result = await sandbox.exec(command, {
      cwd: repoDir,
      signal: abortSignal,
      timeoutMs: 60_000,
    });

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return JSON.stringify({
        error: `rg --files exited with code ${result.exitCode}`,
        stderr: result.stderr.slice(0, 2000),
      });
    }

    const all = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const limited = all.slice(0, max_results);
    const truncated = all.length > max_results;

    return JSON.stringify({
      pattern,
      count: limited.length,
      truncated,
      files: limited,
    });
  },
});

function shellQuote(arg: string): string {
  if (/^[a-zA-Z0-9_./:@=+\-,]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
