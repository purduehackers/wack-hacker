import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { vercel } from "./client.ts";
import { TEAM } from "./constants.ts";
import { epochMillis, pageLimit } from "./fields.ts";

// ──────────────── FIREWALL ────────────────

export const get_firewall_config = defineTool({
  description:
    "Retrieve a firewall configuration version for a project. Pass `configVersion: 'active'` for the live version.",
  access: { risk: "read" },
  input: z.strictObject({
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
  description: "Check whether Vercel detects an active attack on a project.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id: z.string(),
    since: epochMillis.optional(),
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
  description:
    "Enable or disable attack challenge mode (shows a managed challenge page to suspected bots).",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id: z.string(),
    attackModeEnabled: z.boolean(),
    attackModeActiveUntil: epochMillis
      .optional()
      .describe("Unix ms timestamp the challenge expires at"),
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
  description: "List IPs currently allowed to bypass firewall challenges.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id: z.string(),
    sourceIp: z.string().optional(),
    // Not `z.hostname()`: a bypass is scoped to a project domain, and project
    // domains may be wildcards (`*.purduehackers.com`). The SDK documents this
    // only as "Filter by domain", so no format is guaranteed.
    domain: z.string().optional().describe("Filter to this domain; may be a wildcard"),
    projectScope: z.boolean().optional(),
    limit: pageLimit.optional(),
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
  description:
    "List recent firewall events — blocked requests, challenged requests, rate-limit hits.",
  access: { risk: "read" },
  input: z.strictObject({
    projectId: z.string(),
    limit: pageLimit.optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
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
  description: "List auth tokens for the currently-authenticated user.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await vercel().authentication.listAuthTokens();
    return JSON.stringify(result);
  },
});

export const get_auth_token = defineTool({
  description: "Retrieve a specific auth token's metadata.",
  access: { risk: "read" },
  input: z.strictObject({ token_id: z.string() }),
  execute: async ({ token_id }) => {
    const result = await vercel().authentication.getAuthToken({ tokenId: token_id });
    return JSON.stringify(result);
  },
});

export const delete_auth_token = defineTool({
  description: "Revoke (delete) an auth token.",
  access: { risk: "destructive" },
  input: z.strictObject({ token_id: z.string() }),
  execute: async ({ token_id }) => {
    const result = await vercel().authentication.deleteAuthToken({ tokenId: token_id });
    return JSON.stringify(result);
  },
});
