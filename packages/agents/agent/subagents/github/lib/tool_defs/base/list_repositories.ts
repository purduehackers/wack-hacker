import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, paginationInputShape } from "../../constants.ts";

export const list_repositories = defineTool({
  description:
    "List repositories in the purduehackers org. Returns name, description, language, URL, and activity dates. Supports filtering by type and sorting.",
  access: { risk: "read" },
  input: z.strictObject({
    type: z.enum(["all", "public", "private", "forks", "sources", "member"]).optional(),
    sort: z.enum(["created", "updated", "pushed", "full_name"]).optional(),
    ...paginationInputShape,
  }),
  execute: async ({ type, sort, per_page, page }) => {
    const { data } = await octokit().rest.repos.listForOrg({
      org: env.GITHUB_ORG,
      type: type ?? "all",
      sort: sort ?? "updated",
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((r) => ({
        name: r.name,
        full_name: r.full_name,
        description: r.description,
        private: r.private,
        html_url: r.html_url,
        language: r.language,
        default_branch: r.default_branch,
        updated_at: r.updated_at,
        stargazers_count: r.stargazers_count,
        open_issues_count: r.open_issues_count,
        archived: r.archived,
      })),
    );
  },
});
