import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, resourceId } from "../../constants.ts";

export const transfer_repository = defineTool({
  description:
    "Transfer a repository to a different owner (user or org). The new owner receives a transfer invitation which they must accept.",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    new_owner: z.string().min(1).describe("New owner's username or org slug"),
    team_ids: z.array(resourceId).exactOptional().describe("Team IDs to add on transfer"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.repos.transfer({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      transferring: true,
      new_full_name: `${fields.new_owner}/${repo}`,
      html_url: data.html_url,
    });
  },
});
