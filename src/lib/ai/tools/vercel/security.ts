import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── FIREWALL ────────────────

export const get_firewall_config = tool({
  description:
    "Retrieve a firewall configuration version for a project. Pass `configVersion: 'active'` for the live version.",
  inputSchema: z.object({
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

export const get_active_attack_status = tool({
  description: "Check whether Vercel detects an active attack on a project.",
  inputSchema: z.object({
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

export const update_attack_challenge_mode = approval(
  tool({
    description:
      "Enable or disable attack challenge mode (shows a managed challenge page to suspected bots).",
    inputSchema: z.object({
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
  }),
);

// ──────────────── BYPASS IPs ────────────────

export const list_bypass_ips = tool({
  description: "List IPs currently allowed to bypass firewall challenges.",
  inputSchema: z.object({
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

export const list_firewall_events = tool({
  description:
    "List recent firewall events — blocked requests, challenged requests, rate-limit hits.",
  inputSchema: z.object({
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

export const list_auth_tokens = tool({
  description: "List auth tokens for the currently-authenticated user.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await vercel().authentication.listAuthTokens();
    return JSON.stringify(result);
  },
});

export const get_auth_token = tool({
  description: "Retrieve a specific auth token's metadata.",
  inputSchema: z.object({ token_id: z.string() }),
  execute: async ({ token_id }) => {
    const result = await vercel().authentication.getAuthToken({ tokenId: token_id });
    return JSON.stringify(result);
  },
});

export const delete_auth_token = approval(
  tool({
    description: "Revoke (delete) an auth token.",
    inputSchema: z.object({ token_id: z.string() }),
    execute: async ({ token_id }) => {
      const result = await vercel().authentication.deleteAuthToken({ tokenId: token_id });
      return JSON.stringify(result);
    },
  }),
);
