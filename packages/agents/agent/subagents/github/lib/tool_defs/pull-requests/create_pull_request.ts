import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const create_pull_request = defineTool({
  description: `Create a new pull request in a repository. Specify the head branch (with changes) and base branch (to merge into). Supports draft PRs and Markdown body. Returns the PR number, title, URL, and state.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    title: z.string().describe("PR title"),
    body: z.string().exactOptional().describe("PR body (Markdown)"),
    head: z.string().describe("Branch with changes"),
    base: z.string().describe("Branch to merge into"),
    draft: z.boolean().exactOptional(),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.pulls.create({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      number: data.number,
      title: data.title,
      html_url: data.html_url,
      state: data.state,
      draft: data.draft,
    });
  },
});
