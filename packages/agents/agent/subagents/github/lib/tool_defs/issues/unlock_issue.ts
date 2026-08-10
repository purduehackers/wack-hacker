import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, resourceId } from "../../constants.ts";

export const unlock_issue = defineTool({
  description: "Unlock a previously locked issue or PR conversation.",
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    issue_number: resourceId.describe("Issue or PR number"),
  }),
  execute: async ({ repo, issue_number }) => {
    await octokit().rest.issues.unlock({
      owner: env.GITHUB_ORG,
      repo,
      issue_number,
    });
    return JSON.stringify({ unlocked: true, issue_number });
  },
});
