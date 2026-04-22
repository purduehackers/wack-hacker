import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, resolvePath, toRelative } from "./utils.ts";

const MAX_BYTES = 200_000;

export const read = tool({
  description: `Read the contents of a file in the sandbox working tree. Returns up to ${MAX_BYTES} characters, starting at \`offset\` (line-based, 1-indexed).

Use this BEFORE editing a file so you can target exact strings. Prefer targeted reads with \`offset\`/\`limit\` over full-file reads for large files.`,
  inputSchema: z.object({
    path: z.string().describe("File path (absolute, or relative to the repo root)"),
    offset: z.number().int().min(1).optional().describe("1-indexed line to start reading from"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .optional()
      .describe("Maximum number of lines to return"),
  }),
  execute: async ({ path: userPath, offset, limit }, { experimental_context }) => {
    const { sandbox, repoDir } = getSandboxContext(experimental_context, "read");
    let absolute: string;
    try {
      absolute = resolvePath(repoDir, userPath);
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }

    let content: string;
    try {
      content = await sandbox.readFile(absolute);
    } catch (err) {
      return JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
        path: toRelative(repoDir, absolute),
      });
    }

    const lines = content.split("\n");
    const start = offset ? offset - 1 : 0;
    const end = limit ? Math.min(lines.length, start + limit) : lines.length;
    const slice = lines.slice(start, end);

    let rendered = slice
      .map((text, i) => `${String(start + i + 1).padStart(5, " ")}\t${text}`)
      .join("\n");

    let truncatedByBytes = false;
    if (rendered.length > MAX_BYTES) {
      rendered = rendered.slice(0, MAX_BYTES);
      truncatedByBytes = true;
    }

    return JSON.stringify({
      path: toRelative(repoDir, absolute),
      content: rendered,
      line_count: lines.length,
      start_line: start + 1,
      /** Exclusive upper bound (1-indexed, past the last line read). */
      end_line: end + 1,
      truncated_by_bytes: truncatedByBytes,
    });
  },
});
