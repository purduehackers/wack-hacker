import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoName } from "../../constants.ts";

export const create_repository = defineTool({
  description: `Create a new repository in the purduehackers organization. Returns the repo name, URL, visibility, and default branch.`,
  access: { risk: "write" },
  input: z.strictObject({
    name: repoName.describe("Repository name"),
    description: z.string().exactOptional(),
    private: z.boolean().default(true).describe("Whether the repo is private (default true)"),
    auto_init: z.boolean().exactOptional().describe("Initialize with a README"),
    gitignore_template: z.string().exactOptional().describe("Gitignore template (e.g. 'Node')"),
    license_template: z.string().exactOptional().describe("License template (e.g. 'mit')"),
  }),
  execute: async (input) => {
    const { data } = await octokit().rest.repos.createInOrg({
      org: env.GITHUB_ORG,
      ...input,
    });
    return JSON.stringify({
      name: data.name,
      full_name: data.full_name,
      html_url: data.html_url,
      private: data.private,
      default_branch: data.default_branch,
    });
  },
});
