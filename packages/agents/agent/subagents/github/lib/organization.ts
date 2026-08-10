import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { octokit } from "./client.ts";
import { env } from "./config.ts";
import {
  paginationInputShape,
  repoField,
  repoPaginatedInputShape,
  resourceId,
} from "./constants.ts";

const username = z.string().min(1).describe("GitHub username");
const teamSlug = z.string().min(1).describe("Team slug");
const hookId = resourceId.describe("Webhook ID");
const webhookUrl = z.url({ protocol: /^https?$/u }).describe("Webhook payload URL");

export const list_org_members = defineTool({
  description: `List members of the purduehackers organization. Optionally filter by role (all, admin, member). Returns login, ID, avatar URL, and profile URL.`,
  access: { risk: "read" },
  input: z.strictObject({
    role: z.enum(["all", "admin", "member"]).optional(),
    ...paginationInputShape,
  }),
  execute: async ({ role, per_page, page }) => {
    const { data } = await octokit().rest.orgs.listMembers({
      org: env.GITHUB_ORG,
      role: role ?? "all",
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((m) => ({
        login: m.login,
        id: m.id,
        avatar_url: m.avatar_url,
        html_url: m.html_url,
      })),
    );
  },
});

export const get_org_member = defineTool({
  description: `Get organization membership details for a GitHub user. Returns role (admin or member) and state (active or pending).`,
  access: { risk: "read" },
  input: z.strictObject({
    username,
  }),
  execute: async ({ username }) => {
    const { data } = await octokit().rest.orgs.getMembershipForUser({
      org: env.GITHUB_ORG,
      username,
    });
    return JSON.stringify({
      user: data.user?.login,
      role: data.role,
      state: data.state,
    });
  },
});

export const list_teams = defineTool({
  description: `List teams in the purduehackers organization. Returns ID, name, slug, description, privacy, and URL.`,
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
  }),
  execute: async ({ per_page, page }) => {
    const { data } = await octokit().rest.teams.list({
      org: env.GITHUB_ORG,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        description: t.description,
        privacy: t.privacy,
        html_url: t.html_url,
      })),
    );
  },
});

export const get_team = defineTool({
  description: `Get details for a team by slug. Returns ID, name, description, privacy, and URL.`,
  access: { risk: "read" },
  input: z.strictObject({
    team_slug: teamSlug.describe("Team slug (e.g. 'engineering')"),
  }),
  execute: async ({ team_slug }) => {
    const { data } = await octokit().rest.teams.getByName({
      org: env.GITHUB_ORG,
      team_slug,
    });
    return JSON.stringify({
      id: data.id,
      name: data.name,
      slug: data.slug,
      description: data.description,
      privacy: data.privacy,
      html_url: data.html_url,
    });
  },
});

export const list_team_members = defineTool({
  description: `List members of a team. Optionally filter by role (all, member, maintainer). Returns login, ID, and profile URL.`,
  access: { risk: "read" },
  input: z.strictObject({
    team_slug: teamSlug,
    role: z.enum(["all", "member", "maintainer"]).optional(),
    ...paginationInputShape,
  }),
  execute: async ({ team_slug, role, per_page, page }) => {
    const { data } = await octokit().rest.teams.listMembersInOrg({
      org: env.GITHUB_ORG,
      team_slug,
      role: role ?? "all",
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(data.map((m) => ({ login: m.login, id: m.id, html_url: m.html_url })));
  },
});

export const list_repo_webhooks = defineTool({
  description: `List webhooks configured for a repository. Returns ID, active status, subscribed events, and config URL.`,
  access: { risk: "read" },
  input: z.strictObject(repoPaginatedInputShape),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.repos.listWebhooks({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((w) => ({
        id: w.id,
        name: w.name,
        active: w.active,
        events: w.events,
        config: { url: w.config.url, content_type: w.config.content_type },
      })),
    );
  },
});

export const invite_org_member = defineTool({
  description: `Invite a GitHub user to the purduehackers organization or update their role. Role can be "admin" or "member" (default).`,
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    username: username.describe("GitHub username to invite"),
    role: z.enum(["admin", "member"]).optional().describe("Org role (default: member)"),
  }),
  execute: async ({ username, role }) => {
    const { data } = await octokit().rest.orgs.setMembershipForUser({
      org: env.GITHUB_ORG,
      username,
      role: role ?? "member",
    });
    return JSON.stringify({
      user: data.user?.login,
      role: data.role,
      state: data.state,
    });
  },
});

export const remove_org_member = defineTool({
  description: `Remove a user from the purduehackers organization. This revokes all their access to org repos.`,
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    username: username.describe("GitHub username to remove"),
  }),
  execute: async ({ username }) => {
    await octokit().rest.orgs.removeMembershipForUser({
      org: env.GITHUB_ORG,
      username,
    });
    return JSON.stringify({ removed: true, username });
  },
});

export const add_team_member = defineTool({
  description: `Add a user to a team or update their team role. Role can be "member" (default) or "maintainer".`,
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    team_slug: teamSlug,
    username,
    role: z.enum(["member", "maintainer"]).optional().describe("Team role (default: member)"),
  }),
  execute: async ({ team_slug, username, role }) => {
    const { data } = await octokit().rest.teams.addOrUpdateMembershipForUserInOrg({
      org: env.GITHUB_ORG,
      team_slug,
      username,
      role: role ?? "member",
    });
    return JSON.stringify({ username, role: data.role, state: data.state });
  },
});

export const remove_team_member = defineTool({
  description: `Remove a user from a team. They keep org membership but lose team-specific repo access.`,
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    team_slug: teamSlug,
    username,
  }),
  execute: async ({ team_slug, username }) => {
    await octokit().rest.teams.removeMembershipForUserInOrg({
      org: env.GITHUB_ORG,
      team_slug,
      username,
    });
    return JSON.stringify({ removed: true, team_slug, username });
  },
});

export const create_webhook = defineTool({
  description: `Create a webhook for a repository. Specify payload URL, events, and optional secret for signature verification.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    url: webhookUrl,
    content_type: z.enum(["json", "form"]).optional(),
    secret: z.string().exactOptional().describe("Webhook secret for signature verification"),
    events: z.array(z.string()).describe("Events to subscribe to (e.g. ['push', 'pull_request'])"),
    active: z.boolean().optional(),
  }),
  execute: async ({ repo, url, content_type, secret, events, active }) => {
    const { data } = await octokit().rest.repos.createWebhook({
      owner: env.GITHUB_ORG,
      repo,
      config: {
        url,
        content_type: content_type ?? "json",
        ...(secret === undefined ? {} : { secret }),
      },
      events,
      active: active ?? true,
    });
    return JSON.stringify({
      id: data.id,
      active: data.active,
      events: data.events,
    });
  },
});

export const update_webhook = defineTool({
  description: `Update a repository webhook's URL, events, secret, or active status. Only provided fields are changed.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    hook_id: hookId,
    url: webhookUrl.exactOptional(),
    content_type: z.enum(["json", "form"]).exactOptional(),
    // An empty secret is not "leave it alone" — GitHub reads it as "clear the
    // signing secret", so it is rejected rather than forwarded.
    secret: z.string().min(1).exactOptional(),
    events: z.array(z.string()).exactOptional(),
    active: z.boolean().exactOptional(),
  }),
  execute: async ({ repo, hook_id, url, content_type, secret, ...fields }) => {
    const config = {
      ...(url === undefined ? {} : { url }),
      ...(content_type === undefined ? {} : { content_type }),
      ...(secret === undefined ? {} : { secret }),
    };
    const { data } = await octokit().rest.repos.updateWebhook({
      owner: env.GITHUB_ORG,
      repo,
      hook_id,
      ...(Object.keys(config).length === 0 ? {} : { config }),
      ...fields,
    });
    return JSON.stringify({
      id: data.id,
      active: data.active,
      events: data.events,
    });
  },
});

export const delete_webhook = defineTool({
  description: `Delete a repository webhook. Irreversible — the webhook stops receiving events immediately.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    hook_id: hookId,
  }),
  execute: async ({ repo, hook_id }) => {
    await octokit().rest.repos.deleteWebhook({
      owner: env.GITHUB_ORG,
      repo,
      hook_id,
    });
    return JSON.stringify({ deleted: true, hook_id });
  },
});

export const list_org_webhooks = defineTool({
  description: `List webhooks configured for the purduehackers organization. Returns ID, active status, subscribed events, and config URL.`,
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
  }),
  execute: async ({ per_page, page }) => {
    const { data } = await octokit().rest.orgs.listWebhooks({
      org: env.GITHUB_ORG,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((w) => ({
        id: w.id,
        name: w.name,
        active: w.active,
        events: w.events,
        config: { url: w.config.url, content_type: w.config.content_type },
      })),
    );
  },
});
