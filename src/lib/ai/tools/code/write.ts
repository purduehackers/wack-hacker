import * as path from "node:path";
import { z } from "zod";

import { defineTool } from "../_shared/define-tool.ts";
import { getSandboxContext, resolvePath, toRelative } from "./utils.ts";

export const write = defineTool({
  name: "write",
  domain: "code",
  description: `Create a new file or overwrite an existing one with the provided content. Prefer \`edit\` for modifying existing files — \`write\` blows away the whole file.

Refuses paths outside the repo. Creates parent directories as needed.`,
  access: { risk: "write" },
  input: z.object({
    path: z.string().describe("Target file path (absolute or repo-relative)"),
    content: z.string().describe("Full file content to write"),
  }),
  execute: async ({ path: userPath, content }, { experimental_context }) => {
    const { sandbox, repoDir } = getSandboxContext(experimental_context, "write");
    const absolute = resolvePath(repoDir, userPath);

    const parent = path.dirname(absolute);
    if (parent !== absolute) {
      try {
        await sandbox.mkdir(parent, { recursive: true });
      } catch {
        // Filesystems often return already-exists errors; ignore and let writeFile surface real failures.
      }
    }

    let existed = false;
    try {
      await sandbox.readFile(absolute);
      existed = true;
    } catch {
      existed = false;
    }

    await sandbox.writeFile(absolute, content);

    return JSON.stringify({
      path: toRelative(repoDir, absolute),
      bytes: content.length,
      created: !existed,
      overwritten: existed,
    });
  },
});
