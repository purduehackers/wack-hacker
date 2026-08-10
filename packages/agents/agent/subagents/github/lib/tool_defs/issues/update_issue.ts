import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, issueNumber, repoField, resourceId } from "../../constants.ts";

export const update_issue = defineTool({
  description: `Update an existing issue. Can change its title, body, state (open/closed), assignees, labels, or milestone. Returns the updated issue summary.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    issue_number: issueNumber,
    title: z.string().exactOptional(),
    body: z.string().exactOptional(),
    state: z.enum(["open", "closed"]).exactOptional(),
    assignees: z.array(z.string()).exactOptional(),
    labels: z.array(z.string()).exactOptional(),
    milestone: resourceId.nullable().exactOptional().describe("Milestone number; null clears it"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.issues.update({
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
