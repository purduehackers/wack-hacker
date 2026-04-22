import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, resolvePath, toRelative } from "./utils.ts";

export const list_dir = tool({
  description: `List the immediate entries of a directory in the sandbox. Returns each entry's name and type (file/directory/symlink).

Prefer \`glob\` when you want to recursively find files by pattern; \`list_dir\` is for when you need to see what's at one level.`,
  inputSchema: z.object({
    path: z
      .string()
      .default(".")
      .describe("Directory path (absolute or repo-relative). Defaults to the repo root."),
  }),
  execute: async ({ path: userPath }, { experimental_context }) => {
    const { sandbox, repoDir } = getSandboxContext(experimental_context, "list_dir");
    let absolute: string;
    try {
      absolute = resolvePath(repoDir, userPath);
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }

    try {
      const entries = await sandbox.readdir(absolute);
      entries.sort((a, b) => a.name.localeCompare(b.name));
      return JSON.stringify({
        path: toRelative(repoDir, absolute),
        entries: entries.map((e) => ({ name: e.name, type: e.type })),
      });
    } catch (err) {
      return JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
        path: toRelative(repoDir, absolute),
      });
    }
  },
});
