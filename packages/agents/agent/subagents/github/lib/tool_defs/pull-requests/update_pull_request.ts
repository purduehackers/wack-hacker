import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, pullNumber, repoField } from "../../constants.ts";

export const update_pull_request = defineTool({
  description: `Update an existing pull request. Can change its title, body, state (open/closed), or base branch. Returns the updated PR summary.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    pull_number: pullNumber,
    title: z.string().exactOptional(),
    body: z.string().exactOptional(),
    state: z.enum(["open", "closed"]).exactOptional(),
    base: z.string().exactOptional().describe("Change the base branch"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.pulls.update({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      number: data.number,
      title: data.title,
      html_url: data.html_url,
      state: data.state,
    });
  },
});
