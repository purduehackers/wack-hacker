import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, resourceId } from "../../constants.ts";

export const add_assignees = defineTool({
  description: "Add assignees to an issue or PR. Up to 10 assignees.",
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    issue_number: resourceId.describe("Issue or PR number"),
    assignees: z.array(z.string()).min(1).max(10).describe("GitHub usernames to assign"),
  }),
  execute: async ({ repo, issue_number, assignees }) => {
    const { data } = await octokit().rest.issues.addAssignees({
      owner: env.GITHUB_ORG,
      repo,
      issue_number,
      assignees,
    });
    return JSON.stringify({
      number: data.number,
      assignees: data.assignees?.map((a) => a.login),
    });
  },
});
