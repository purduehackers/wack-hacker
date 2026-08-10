import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoPaginatedInputShape } from "../../constants.ts";

export const list_environments = defineTool({
  description:
    "List deployment environments for a repository. Returns name, URL, protection rules, and timestamps.",
  access: { risk: "read" },
  input: z.strictObject(repoPaginatedInputShape),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.repos.getAllEnvironments({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      environments: (data.environments ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        url: e.url,
        html_url: e.html_url,
        created_at: e.created_at,
        updated_at: e.updated_at,
        protection_rules: e.protection_rules,
      })),
    });
  },
});
