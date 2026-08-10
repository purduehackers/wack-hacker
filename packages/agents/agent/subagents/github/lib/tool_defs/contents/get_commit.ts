import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const get_commit = defineTool({
  description: `Get full details for a single commit, including message, author, date, stats (additions/deletions), and a list of changed files with their status and line counts.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    ref: z.string().describe("Commit SHA, branch, or tag"),
  }),
  execute: async ({ repo, ref }) => {
    const { data } = await octokit().rest.repos.getCommit({
      owner: env.GITHUB_ORG,
      repo,
      ref,
    });
    return JSON.stringify({
      sha: data.sha,
      message: data.commit.message,
      author: data.commit.author?.name,
      date: data.commit.author?.date,
      html_url: data.html_url,
      stats: data.stats,
      files: data.files?.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    });
  },
});
