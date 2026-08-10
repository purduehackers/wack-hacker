import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit, octokitStatus } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const get_pages_info = defineTool({
  description: `Get the GitHub Pages configuration for a repository, including the published URL, status, source branch/path, and HTTPS enforcement. Returns a message if Pages is not enabled.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
  }),
  execute: async ({ repo }) => {
    try {
      const { data } = await octokit().rest.repos.getPages({
        owner: env.GITHUB_ORG,
        repo,
      });
      return JSON.stringify({
        url: data.url,
        html_url: data.html_url,
        status: data.status,
        source: data.source,
        https_enforced: data.https_enforced,
      });
    } catch (e: unknown) {
      if (octokitStatus(e) === 404)
        return JSON.stringify({
          enabled: false,
          message: "GitHub Pages is not enabled for this repository",
        });
      throw e;
    }
  },
});
