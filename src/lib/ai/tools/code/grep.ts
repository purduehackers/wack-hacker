import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, resolvePath } from "./utils.ts";

const MAX_MATCHES = 500;

export const grep = tool({
  description: `Search file contents with ripgrep. Returns matching lines grouped by file.

Use specific patterns — regex is supported. Narrow with \`glob\` (e.g. \`**/*.ts\`) when possible. Prefer this over a bash \`rg\` call since the output is structured.`,
  inputSchema: z.object({
    pattern: z.string().min(1).describe("Regex pattern to search for"),
    path: z
      .string()
      .default(".")
      .describe("Directory to search (absolute or repo-relative). Defaults to the repo root."),
    glob: z.string().optional().describe(`Optional glob filter (e.g. "**/*.ts", "src/**/*.md")`),
    case_insensitive: z.boolean().default(false).describe("Match regardless of case"),
    max_count: z
      .number()
      .int()
      .min(1)
      .max(MAX_MATCHES)
      .default(100)
      .describe("Stop after this many matches"),
  }),
  execute: async (
    { pattern, path: userPath, glob, case_insensitive, max_count },
    { experimental_context, abortSignal },
  ) => {
    const { sandbox, repoDir } = getSandboxContext(experimental_context, "grep");
    let absolute: string;
    try {
      absolute = resolvePath(repoDir, userPath);
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }

    const args = ["--json", "--max-count", String(max_count)];
    if (case_insensitive) args.push("-i");
    if (glob) args.push("--glob", glob);
    args.push("-e", pattern, "--", absolute);

    const command = `rg ${args.map(shellQuote).join(" ")}`;
    const result = await sandbox.exec(command, {
      cwd: repoDir,
      signal: abortSignal,
      timeoutMs: 60_000,
    });

    // rg exits with 1 when it finds no matches — that's not an error for us
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return JSON.stringify({
        error: `ripgrep exited with code ${result.exitCode}`,
        stderr: result.stderr.slice(0, 2000),
      });
    }

    const matches = parseRgJson(result.stdout);

    return JSON.stringify({
      pattern,
      match_count: matches.length,
      matches: matches.slice(0, max_count),
      truncated: matches.length > max_count,
    });
  },
});

interface RgMatch {
  path: string;
  line_number: number;
  text: string;
}

function parseRgJson(stdout: string): RgMatch[] {
  const out: RgMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        data?: {
          path?: { text?: string };
          line_number?: number;
          lines?: { text?: string };
        };
      };
      if (event.type !== "match" || !event.data) continue;
      const text = (event.data.lines?.text ?? "").replace(/\n$/, "");
      out.push({
        path: event.data.path?.text ?? "",
        line_number: event.data.line_number ?? 0,
        text,
      });
    } catch {
      // Malformed line — skip. rg occasionally emits status events with non-UTF8 bytes.
    }
  }
  return out;
}

function shellQuote(arg: string): string {
  if (/^[a-zA-Z0-9_./:@=+\-,]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
