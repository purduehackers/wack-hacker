import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, perPageField, repoField } from "../../constants.ts";

export const list_repo_invitations = defineTool({
  description:
    "List pending collaborator invitations for a repository. Returns inviter, invitee, permission, and URL.",
  access: { risk: "read", minRole: "admin" },
  input: z.strictObject({
    repo: repoField,
    per_page: perPageField,
  }),
  execute: async ({ repo, per_page }) => {
    const { data } = await octokit().rest.repos.listInvitations({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 30,
    });
    return JSON.stringify(
      data.map((inv) => ({
        id: inv.id,
        inviter: inv.inviter?.login,
        invitee: inv.invitee?.login,
        permissions: inv.permissions,
        html_url: inv.html_url,
        created_at: inv.created_at,
      })),
    );
  },
});
