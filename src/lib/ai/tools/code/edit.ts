import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, resolvePath, toRelative } from "./utils.ts";

export const edit = tool({
  description: `Make an exact string replacement in a file. The \`old_string\` must appear exactly once in the file unless \`replace_all\` is true.

Prefer this over \`write\` for incremental changes — it preserves surrounding content and is less destructive if the model gets something wrong.`,
  inputSchema: z.object({
    path: z.string().describe("File to edit (absolute or repo-relative)"),
    old_string: z
      .string()
      .min(1)
      .describe("Exact text to replace. Must be unique in the file unless replace_all is true."),
    new_string: z.string().describe("Replacement text"),
    replace_all: z
      .boolean()
      .default(false)
      .describe("Replace every occurrence instead of requiring uniqueness"),
  }),
  execute: async (
    { path: userPath, old_string, new_string, replace_all },
    { experimental_context },
  ) => {
    const { sandbox, repoDir } = getSandboxContext(experimental_context, "edit");
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

    if (old_string === new_string) {
      return JSON.stringify({
        error: "old_string and new_string are identical; nothing to do",
        path: toRelative(repoDir, absolute),
      });
    }

    const occurrences = countOccurrences(content, old_string);
    if (occurrences === 0) {
      return JSON.stringify({
        error: "old_string not found in file",
        path: toRelative(repoDir, absolute),
      });
    }
    if (!replace_all && occurrences > 1) {
      return JSON.stringify({
        error: `old_string appears ${occurrences} times; pass replace_all: true or provide more context to make it unique`,
        path: toRelative(repoDir, absolute),
      });
    }

    const updated = replace_all
      ? content.split(old_string).join(new_string)
      : content.replace(old_string, new_string);

    try {
      await sandbox.writeFile(absolute, updated);
    } catch (err) {
      return JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
        path: toRelative(repoDir, absolute),
      });
    }

    return JSON.stringify({
      path: toRelative(repoDir, absolute),
      replacements: replace_all ? occurrences : 1,
    });
  },
});

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}
