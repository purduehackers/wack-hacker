import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, resourceId } from "../../constants.ts";

export const lock_issue = defineTool({
  description:
    "Lock the conversation on an issue or PR so only collaborators can comment. Useful for derailed threads.",
  access: { risk: "write", confirm: "self" },
  input: z.strictObject({
    repo: repoField,
    issue_number: resourceId.describe("Issue or PR number"),
    lock_reason: z
      .enum(["off-topic", "too heated", "resolved", "spam"])
      .exactOptional()
      .describe("Reason for locking"),
  }),
  execute: async ({ repo, ...fields }) => {
    await octokit().rest.issues.lock({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({ locked: true, issue_number: fields.issue_number });
  },
});
