import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoPaginatedInputShape } from "../../constants.ts";

export const list_workflows = defineTool({
  description: `List CI/CD workflows defined in a repository's .github/workflows directory. Returns each workflow's ID, name, file path, state, and URL.`,
  access: { risk: "read" },
  input: z.strictObject(repoPaginatedInputShape),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.actions.listRepoWorkflows({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      workflows: data.workflows.map((w) => ({
        id: w.id,
        name: w.name,
        path: w.path,
        state: w.state,
        html_url: w.html_url,
      })),
    });
  },
});
