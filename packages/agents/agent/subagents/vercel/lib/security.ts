import { z } from "zod";

import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";
import { defineTool } from "./define-tool.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── FIREWALL ────────────────

export const get_firewall_config = defineTool({
  name: "get_firewall_config",
  domain: "vercel",
  description:
    "Retrieve a firewall configuration version for a project. Pass `configVersion: 'active'` for the live version.",
  access: { risk: "read" },
  input: z.object({
    project_id: z.string(),
    configVersion: z.string().describe("Config version id, or 'active'"),
  }),
  execute: async ({ project_id, configVersion }) => {
    const result = await vercel().security.getFirewallConfig({
      ...TEAM,
      projectId: project_id,
      configVersion,
    });
    return JSON.stringify(result);
  },
});

export const get_active_attack_status = defineTool({
  name: "get_active_attack_status",
  domain: "vercel",
  description: "Check whether Vercel detects an active attack on a project.",
  access: { risk: "read" },
  input: z.object({
    project_id: z.string(),
    since: z.number().optional(),
  }),
  execute: async ({ project_id, since }) => {
    const result = await vercel().security.getActiveAttackStatus({
      ...TEAM,
      projectId: project_id,
      since,
    });
    return JSON.stringify(result);
  },
});

export const update_attack_challenge_mode = defineTool({
  name: "update_attack_challenge_mode",
  domain: "vercel",
  description:
    "Enable or disable attack challenge mode (shows a managed challenge page to suspected bots).",
  access: { risk: "destructive" },
  input: z.object({
    project_id: z.string(),
    attackModeEnabled: z.boolean(),
    attackModeActiveUntil: z.number().optional(),
  }),
  execute: async ({ project_id, attackModeEnabled, attackModeActiveUntil }) => {
    const result = await vercel().security.updateAttackChallengeMode({
      ...TEAM,
      requestBody:
        attackModeActiveUntil !== undefined
          ? { projectId: project_id, attackModeEnabled, attackModeActiveUntil }
          : { projectId: project_id, attackModeEnabled },
    });
    return JSON.stringify(result);
  },
});

// ──────────────── BYPASS IPs ────────────────

export const list_bypass_ips = defineTool({
  name: "list_bypass_ips",
  domain: "vercel",
  description: "List IPs currently allowed to bypass firewall challenges.",
  access: { risk: "read" },
  input: z.object({
    project_id: z.string(),
    sourceIp: z.string().optional(),
    domain: z.string().optional(),
    projectScope: z.boolean().optional(),
    limit: z.number().optional(),
    offset: z.string().optional().describe("Pagination cursor id"),
  }),
  execute: async ({ project_id, ...query }) => {
    const result = await vercel().security.getBypassIp({
      ...TEAM,
      projectId: project_id,
      ...query,
    });
    return JSON.stringify(result);
  },
});

export const list_firewall_events = defineTool({
  name: "list_firewall_events",
  domain: "vercel",
  description:
    "List recent firewall events — blocked requests, challenged requests, rate-limit hits.",
  access: { risk: "read" },
  input: z.object({
    projectId: z.string(),
    limit: z.number().optional(),
    since: z.number().optional(),
    until: z.number().optional(),
    ruleId: z.string().optional(),
    actionType: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().security.getSecurityFirewallEvents({
      ...TEAM,
      ...input,
    });
    return JSON.stringify(result);
  },
});

// ──────────────── AUTH TOKENS ────────────────

export const list_auth_tokens = defineTool({
  name: "list_auth_tokens",
  domain: "vercel",
  description: "List auth tokens for the currently-authenticated user.",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const result = await vercel().authentication.listAuthTokens();
    return JSON.stringify(result);
  },
});

export const get_auth_token = defineTool({
  name: "get_auth_token",
  domain: "vercel",
  description: "Retrieve a specific auth token's metadata.",
  access: { risk: "read" },
  input: z.object({ token_id: z.string() }),
  execute: async ({ token_id }) => {
    const result = await vercel().authentication.getAuthToken({ tokenId: token_id });
    return JSON.stringify(result);
  },
});

export const delete_auth_token = defineTool({
  name: "delete_auth_token",
  domain: "vercel",
  description: "Revoke (delete) an auth token.",
  access: { risk: "destructive" },
  input: z.object({ token_id: z.string() }),
  execute: async ({ token_id }) => {
    const result = await vercel().authentication.deleteAuthToken({ tokenId: token_id });
    return JSON.stringify(result);
  },
});
