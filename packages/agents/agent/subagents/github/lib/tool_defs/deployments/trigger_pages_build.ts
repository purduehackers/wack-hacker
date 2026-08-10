import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const trigger_pages_build = defineTool({
  description: `Manually trigger a GitHub Pages build for a repository. Returns the build status and URL. Only works for repos with Pages enabled.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
  }),
  execute: async ({ repo }) => {
    const { data } = await octokit().rest.repos.requestPagesBuild({
      owner: env.GITHUB_ORG,
      repo,
    });
    return JSON.stringify({ status: data.status, url: data.url });
  },
});
