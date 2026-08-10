import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, resourceId } from "../../constants.ts";

export const remove_assignees = defineTool({
  description: "Remove assignees from an issue or PR.",
  access: { risk: "write", confirm: "self" },
  input: z.strictObject({
    repo: repoField,
    issue_number: resourceId.describe("Issue or PR number"),
    assignees: z.array(z.string()).min(1).describe("GitHub usernames to unassign"),
  }),
  execute: async ({ repo, issue_number, assignees }) => {
    const { data } = await octokit().rest.issues.removeAssignees({
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
