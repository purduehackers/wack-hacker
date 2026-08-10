import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const get_directory_tree = defineTool({
  description: `Get the full recursive directory tree of a repository. Returns all file and directory paths with their types and sizes. Useful for understanding project structure. May be truncated for very large repos.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    tree_sha: z.string().optional().describe("Tree SHA or branch name (defaults to HEAD)"),
  }),
  execute: async ({ repo, tree_sha }) => {
    const sha = tree_sha ?? "HEAD";
    const { data } = await octokit().rest.git.getTree({
      owner: env.GITHUB_ORG,
      repo,
      tree_sha: sha,
      recursive: "1",
    });
    return JSON.stringify({
      sha: data.sha,
      truncated: data.truncated,
      tree: data.tree.map((t) => ({
        path: t.path,
        type: t.type,
        size: t.size,
      })),
    });
  },
});
