import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, resourceId } from "../../constants.ts";

export const cancel_repo_invitation = defineTool({
  description: "Revoke a pending collaborator invitation by ID.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    repo: repoField,
    invitation_id: resourceId.describe("Invitation ID"),
  }),
  execute: async ({ repo, invitation_id }) => {
    await octokit().rest.repos.deleteInvitation({
      owner: env.GITHUB_ORG,
      repo,
      invitation_id,
    });
    return JSON.stringify({ revoked: true, invitation_id });
  },
});
