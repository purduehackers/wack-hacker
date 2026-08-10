import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { octokit } from "./client.ts";
import { env } from "./config.ts";
import { perPageField, repoField, resourceId } from "./constants.ts";

export const list_collaborators = defineTool({
  description:
    "List collaborators with direct access to a repository. Returns login, permissions, and role.",
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    affiliation: z.enum(["outside", "direct", "all"]).optional(),
    per_page: perPageField,
  }),
  execute: async ({ repo, affiliation, per_page }) => {
    const { data } = await octokit().rest.repos.listCollaborators({
      owner: env.GITHUB_ORG,
      repo,
      affiliation: affiliation ?? "all",
      per_page: per_page ?? 30,
    });
    return JSON.stringify(
      data.map((c) => ({
        login: c.login,
        permissions: c.permissions,
        role_name: c.role_name,
      })),
    );
  },
});

export const add_collaborator = defineTool({
  description:
    "Add a user as a direct collaborator on a repository. Permission defaults to 'push' (write). Options: pull, triage, push, maintain, admin.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    repo: repoField,
    username: z.string().min(1).describe("GitHub username"),
    permission: z
      .enum(["pull", "triage", "push", "maintain", "admin"])
      .optional()
      .describe("Permission level (default push)"),
  }),
  execute: async ({ repo, username, permission }) => {
    const { data } = await octokit().rest.repos.addCollaborator({
      owner: env.GITHUB_ORG,
      repo,
      username,
      permission: permission ?? "push",
    });
    return JSON.stringify({
      user: username,
      permission: permission ?? "push",
      invitation_id: data?.id,
    });
  },
});

export const remove_collaborator = defineTool({
  description: "Remove a collaborator from a repository. Revokes their direct access.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    repo: repoField,
    username: z.string().min(1).describe("GitHub username to remove"),
  }),
  execute: async ({ repo, username }) => {
    await octokit().rest.repos.removeCollaborator({
      owner: env.GITHUB_ORG,
      repo,
      username,
    });
    return JSON.stringify({ removed: true, username });
  },
});

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
