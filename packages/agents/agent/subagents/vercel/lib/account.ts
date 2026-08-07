import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

export const whoami = defineTool({
  description:
    "Return the authenticated Vercel user and the active Purdue Hackers team context. Useful as a debug smoke test.",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const user = await vercel().user.getAuthUser();
    return JSON.stringify({
      user,
      team: { id: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG },
    });
  },
});

export const list_teams = defineTool({
  description:
    "List every Vercel team the authenticated account belongs to. Returns id, slug, name, createdAt. Paginated via `limit` / `since` / `until`.",
  access: { risk: "read" },
  input: z.object({
    limit: z.number().max(100).optional(),
    since: z.number().optional().describe("Unix ms timestamp lower bound"),
    until: z.number().optional().describe("Unix ms timestamp upper bound"),
  }),
  execute: async ({ limit, since, until }) => {
    const result = await vercel().teams.getTeams({ limit, since, until });
    return JSON.stringify(result);
  },
});

export const list_user_events = defineTool({
  description:
    "List recent audit events for the authenticated user scoped to the active Vercel team — useful for investigating who ran what (e.g. promotions, env var edits, member changes).",
  access: { risk: "read" },
  input: z.object({
    limit: z.number().max(100).optional(),
    types: z
      .string()
      .optional()
      .describe(
        "Comma-separated event type filters (e.g. 'deployment.created,deployment-ready'). Call list_event_types to discover options.",
      ),
    userId: z.string().optional().describe("Filter to events emitted by this user id"),
    projectId: z.string().optional(),
    since: z.string().optional().describe("ISO timestamp lower bound"),
    until: z.string().optional().describe("ISO timestamp upper bound"),
  }),
  execute: async ({ limit, types, userId, projectId, since, until }) => {
    const result = await vercel().user.listUserEvents({
      teamId: VERCEL_TEAM_ID,
      slug: VERCEL_TEAM_SLUG,
      limit,
      types,
      userId,
      projectIds: projectId,
      since,
      until,
    });
    return JSON.stringify(result);
  },
});

export const list_event_types = defineTool({
  description:
    "List every user-facing event type the audit log recognises. Use this before calling list_user_events with a specific `types` filter.",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const result = await vercel().user.listEventTypes({
      teamId: VERCEL_TEAM_ID,
      slug: VERCEL_TEAM_SLUG,
    });
    return JSON.stringify(result);
  },
});
