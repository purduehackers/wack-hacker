import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, pullPaginatedInputShape } from "../../constants.ts";

export const list_pr_files = defineTool({
  description: `List files changed in a pull request. Returns each file's name, status (added/modified/removed), lines added/deleted, and a truncated patch preview. Useful for understanding the scope of changes.`,
  access: { risk: "read" },
  input: z.strictObject(pullPaginatedInputShape),
  execute: async ({ repo, pull_number, per_page, page }) => {
    const { data } = await octokit().rest.pulls.listFiles({
      owner: env.GITHUB_ORG,
      repo,
      pull_number,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch?.slice(0, 500),
      })),
    );
  },
});
