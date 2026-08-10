import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const get_repository = defineTool({
  description:
    "Get full details for a repository — description, branches, topics, visibility, license, issue/wiki/pages status, and URLs.",
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField.describe("Repository name (e.g. 'my-repo')"),
  }),
  execute: async ({ repo }) => {
    const { data } = await octokit().rest.repos.get({
      owner: env.GITHUB_ORG,
      repo,
    });
    return JSON.stringify({
      name: data.name,
      full_name: data.full_name,
      description: data.description,
      private: data.private,
      html_url: data.html_url,
      language: data.language,
      default_branch: data.default_branch,
      created_at: data.created_at,
      updated_at: data.updated_at,
      pushed_at: data.pushed_at,
      stargazers_count: data.stargazers_count,
      forks_count: data.forks_count,
      open_issues_count: data.open_issues_count,
      archived: data.archived,
      topics: data.topics,
      visibility: data.visibility,
      license: data.license?.spdx_id,
      has_issues: data.has_issues,
      has_wiki: data.has_wiki,
      has_pages: data.has_pages,
    });
  },
});
