import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoPaginatedInputShape } from "../../constants.ts";

export const list_pages_builds = defineTool({
  description: `List GitHub Pages builds for a repository. Returns each build's status, error info, timestamps, and duration. Useful for debugging Pages deployment issues.`,
  access: { risk: "read" },
  input: z.strictObject(repoPaginatedInputShape),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.repos.listPagesBuilds({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 10,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((b) => ({
        status: b.status,
        error: b.error,
        created_at: b.created_at,
        updated_at: b.updated_at,
        duration: b.duration,
      })),
    );
  },
});
