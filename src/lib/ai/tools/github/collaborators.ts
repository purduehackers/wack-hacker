import { z } from "zod";

import { env } from "../../../../env.ts";
import { perPageField } from "../_shared/constants.ts";
import { defineTool } from "../_shared/define-tool.ts";
import { octokit } from "./client.ts";

export const list_collaborators = defineTool({
  name: "list_collaborators",
  domain: "github",
  description:
    "List collaborators with direct access to a repository. Returns login, permissions, and role.",
  access: { risk: "read" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    affiliation: z.enum(["outside", "direct", "all"]).optional(),
    per_page: perPageField,
  }),
  execute: async ({ repo, affiliation, per_page }) => {
    const { data } = await octokit.rest.repos.listCollaborators({
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
  name: "add_collaborator",
  domain: "github",
  description:
    "Add a user as a direct collaborator on a repository. Permission defaults to 'push' (write). Options: pull, triage, push, maintain, admin.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    username: z.string().describe("GitHub username"),
    permission: z
      .enum(["pull", "triage", "push", "maintain", "admin"])
      .optional()
      .describe("Permission level (default push)"),
  }),
  execute: async ({ repo, username, permission }) => {
    const { data } = await octokit.rest.repos.addCollaborator({
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
  name: "remove_collaborator",
  domain: "github",
  description: "Remove a collaborator from a repository. Revokes their direct access.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    username: z.string().describe("GitHub username to remove"),
  }),
  execute: async ({ repo, username }) => {
    await octokit.rest.repos.removeCollaborator({
      owner: env.GITHUB_ORG,
      repo,
      username,
    });
    return JSON.stringify({ removed: true, username });
  },
});

export const list_repo_invitations = defineTool({
  name: "list_repo_invitations",
  domain: "github",
  description:
    "List pending collaborator invitations for a repository. Returns inviter, invitee, permission, and URL.",
  access: { risk: "read", minRole: "admin" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    per_page: perPageField,
  }),
  execute: async ({ repo, per_page }) => {
    const { data } = await octokit.rest.repos.listInvitations({
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
  name: "cancel_repo_invitation",
  domain: "github",
  description: "Revoke a pending collaborator invitation by ID.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    repo: z.string().describe("Repository name"),
    invitation_id: z.number().describe("Invitation ID"),
  }),
  execute: async ({ repo, invitation_id }) => {
    await octokit.rest.repos.deleteInvitation({
      owner: env.GITHUB_ORG,
      repo,
      invitation_id,
    });
    return JSON.stringify({ revoked: true, invitation_id });
  },
});
