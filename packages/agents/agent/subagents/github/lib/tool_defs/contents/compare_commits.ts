import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const compare_commits = defineTool({
  description: `Compare two commits, branches, or tags. Returns the comparison status (ahead/behind/diverged), commit count, a list of commits between them, and changed files with their diffs. Useful for understanding what changed between releases or branches.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    base: z.string().describe("Base ref (branch, tag, or SHA)"),
    head: z.string().describe("Head ref (branch, tag, or SHA)"),
  }),
  execute: async ({ repo, base, head }) => {
    const { data } = await octokit().rest.repos.compareCommitsWithBasehead({
      owner: env.GITHUB_ORG,
      repo,
      basehead: `${base}...${head}`,
    });
    return JSON.stringify({
      status: data.status,
      ahead_by: data.ahead_by,
      behind_by: data.behind_by,
      total_commits: data.total_commits,
      html_url: data.html_url,
      commits: data.commits.map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message,
        author: c.commit.author?.name,
      })),
      files: data.files?.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    });
  },
});
