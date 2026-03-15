import { tool } from "ai";
import { z } from "zod";

import { SkillSystem } from "../../../context/skills";
import { octokit } from "../client";
import { ORG } from "../constants";

const json = JSON.stringify;

export const list_org_members = tool({
  description: `List members of the purduehackers organization. Optionally filter by role (all, admin, member). Returns login, ID, avatar URL, and profile URL.`,
  inputSchema: z.object({
    role: z.enum(["all", "admin", "member"]).optional(),
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ role, per_page, page }) => {
    const { data } = await octokit.rest.orgs.listMembers({
      org: ORG,
      role: role ?? "all",
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return json(
      data.map((m) => ({
        login: m.login,
        id: m.id,
        avatar_url: m.avatar_url,
        html_url: m.html_url,
      })),
    );
  },
});

export const get_org_member = tool({
  description: `Get organization membership details for a GitHub user. Returns role (admin or member) and state (active or pending).`,
  inputSchema: z.object({
    username: z.string().describe("GitHub username"),
  }),
  execute: async ({ username }) => {
    const { data } = await octokit.rest.orgs.getMembershipForUser({ org: ORG, username });
    return json({ user: data.user?.login, role: data.role, state: data.state });
  },
});

export const list_teams = tool({
  description: `List teams in the purduehackers organization. Returns ID, name, slug, description, privacy, and URL.`,
  inputSchema: z.object({
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ per_page, page }) => {
    const { data } = await octokit.rest.teams.list({
      org: ORG,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return json(
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

export const get_team = tool({
  description: `Get details for a team by slug. Returns ID, name, description, privacy, and URL.`,
  inputSchema: z.object({
    team_slug: z.string().describe("Team slug (e.g. 'engineering')"),
  }),
  execute: async ({ team_slug }) => {
    const { data } = await octokit.rest.teams.getByName({ org: ORG, team_slug });
    return json({
      id: data.id,
      name: data.name,
      slug: data.slug,
      description: data.description,
      privacy: data.privacy,
      html_url: data.html_url,
    });
  },
});

export const list_team_members = tool({
  description: `List members of a team. Optionally filter by role (all, member, maintainer). Returns login, ID, and profile URL.`,
  inputSchema: z.object({
    team_slug: z.string().describe("Team slug"),
    role: z.enum(["all", "member", "maintainer"]).optional(),
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ team_slug, role, per_page, page }) => {
    const { data } = await octokit.rest.teams.listMembersInOrg({
      org: ORG,
      team_slug,
      role: role ?? "all",
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return json(data.map((m) => ({ login: m.login, id: m.id, html_url: m.html_url })));
  },
});

export const list_repo_webhooks = tool({
  description: `List webhooks configured for a repository. Returns ID, active status, subscribed events, and config URL.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit.rest.repos.listWebhooks({
      owner: ORG,
      repo,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return json(
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

export const invite_org_member = SkillSystem.admin(
  tool({
    description: `Invite a GitHub user to the purduehackers organization or update their role. Role can be "admin" or "member" (default).`,
    inputSchema: z.object({
      username: z.string().describe("GitHub username to invite"),
      role: z.enum(["admin", "member"]).optional().describe("Org role (default: member)"),
    }),
    execute: async ({ username, role }) => {
      const { data } = await octokit.rest.orgs.setMembershipForUser({
        org: ORG,
        username,
        role: role ?? "member",
      });
      return json({ user: data.user?.login, role: data.role, state: data.state });
    },
  }),
);

export const remove_org_member = SkillSystem.admin(
  tool({
    description: `Remove a user from the purduehackers organization. This revokes all their access to org repos.`,
    inputSchema: z.object({
      username: z.string().describe("GitHub username to remove"),
    }),
    execute: async ({ username }) => {
      await octokit.rest.orgs.removeMembershipForUser({ org: ORG, username });
      return json({ removed: true, username });
    },
  }),
);

export const add_team_member = SkillSystem.admin(
  tool({
    description: `Add a user to a team or update their team role. Role can be "member" (default) or "maintainer".`,
    inputSchema: z.object({
      team_slug: z.string().describe("Team slug"),
      username: z.string().describe("GitHub username"),
      role: z.enum(["member", "maintainer"]).optional().describe("Team role (default: member)"),
    }),
    execute: async ({ team_slug, username, role }) => {
      const { data } = await octokit.rest.teams.addOrUpdateMembershipForUserInOrg({
        org: ORG,
        team_slug,
        username,
        role: role ?? "member",
      });
      return json({ username, role: data.role, state: data.state });
    },
  }),
);

export const remove_team_member = SkillSystem.admin(
  tool({
    description: `Remove a user from a team. They keep org membership but lose team-specific repo access.`,
    inputSchema: z.object({
      team_slug: z.string().describe("Team slug"),
      username: z.string().describe("GitHub username"),
    }),
    execute: async ({ team_slug, username }) => {
      await octokit.rest.teams.removeMembershipForUserInOrg({ org: ORG, team_slug, username });
      return json({ removed: true, team_slug, username });
    },
  }),
);

export const create_webhook = tool({
  description: `Create a webhook for a repository. Specify payload URL, events, and optional secret for signature verification.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    url: z.string().describe("Webhook payload URL"),
    content_type: z.enum(["json", "form"]).optional(),
    secret: z.string().optional().describe("Webhook secret for signature verification"),
    events: z.array(z.string()).describe("Events to subscribe to (e.g. ['push', 'pull_request'])"),
    active: z.boolean().optional(),
  }),
  execute: async ({ repo, url, content_type, secret, events, active }) => {
    const { data } = await octokit.rest.repos.createWebhook({
      owner: ORG,
      repo,
      config: { url, content_type: content_type ?? "json", secret },
      events,
      active: active ?? true,
    });
    return json({ id: data.id, active: data.active, events: data.events });
  },
});

export const update_webhook = tool({
  description: `Update a repository webhook's URL, events, secret, or active status. Only provided fields are changed.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    hook_id: z.number().describe("Webhook ID"),
    url: z.string().optional(),
    content_type: z.enum(["json", "form"]).optional(),
    secret: z.string().optional(),
    events: z.array(z.string()).optional(),
    active: z.boolean().optional(),
  }),
  execute: async ({ repo, hook_id, url, content_type, secret, events, active }) => {
    const config: Record<string, string> = {};
    if (url) config.url = url;
    if (content_type) config.content_type = content_type;
    if (secret) config.secret = secret;
    const { data } = await octokit.rest.repos.updateWebhook({
      owner: ORG,
      repo,
      hook_id,
      config: Object.keys(config).length > 0 ? config : undefined,
      events,
      active,
    });
    return json({ id: data.id, active: data.active, events: data.events });
  },
});

export const delete_webhook = tool({
  description: `Delete a repository webhook. Irreversible — the webhook stops receiving events immediately.`,
  inputSchema: z.object({
    repo: z.string().describe("Repository name"),
    hook_id: z.number().describe("Webhook ID"),
  }),
  execute: async ({ repo, hook_id }) => {
    await octokit.rest.repos.deleteWebhook({ owner: ORG, repo, hook_id });
    return json({ deleted: true, hook_id });
  },
});

export const list_org_webhooks = tool({
  description: `List webhooks configured for the purduehackers organization. Returns ID, active status, subscribed events, and config URL.`,
  inputSchema: z.object({
    per_page: z.number().max(100).optional(),
    page: z.number().optional(),
  }),
  execute: async ({ per_page, page }) => {
    const { data } = await octokit.rest.orgs.listWebhooks({
      org: ORG,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return json(
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
