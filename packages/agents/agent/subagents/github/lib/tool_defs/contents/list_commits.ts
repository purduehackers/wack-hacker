import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, isoDateOrDateTime, paginationInputShape, repoField } from "../../constants.ts";

export const list_commits = defineTool({
  description: `List commits for a repository, optionally filtered by branch, file path, or date range. Returns abbreviated SHA, message, author, date, and URL for each commit.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    sha: z.string().exactOptional().describe("Branch or SHA to list from"),
    path: z.string().exactOptional().describe("Filter to commits affecting this path"),
    since: isoDateOrDateTime
      .exactOptional()
      .describe("ISO 8601 date or timestamp — inclusive lower bound"),
    until: isoDateOrDateTime
      .exactOptional()
      .describe("ISO 8601 date or timestamp — inclusive upper bound"),
    ...paginationInputShape,
  }),
  execute: async ({ repo, per_page, page, ...filters }) => {
    const { data } = await octokit().rest.repos.listCommits({
      owner: env.GITHUB_ORG,
      repo,
      ...filters,
      per_page: per_page ?? 20,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message,
        author: c.commit.author?.name,
        date: c.commit.author?.date,
        html_url: c.html_url,
      })),
    );
  },
});
