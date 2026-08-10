import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { isoTimestamp, pageLimit, VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "../../constants.ts";

export const list_user_events = defineTool({
  description:
    "List recent audit events for the authenticated user scoped to the active Vercel team — useful for investigating who ran what (e.g. promotions, env var edits, member changes).",
  access: { risk: "read" },
  input: z.strictObject({
    limit: pageLimit.max(100).optional(),
    types: z
      .string()
      .optional()
      .describe(
        "Comma-separated event type filters (e.g. 'deployment.created,deployment-ready'). Call list_event_types to discover options.",
      ),
    userId: z.string().optional().describe("Filter to events emitted by this user id"),
    projectId: z.string().optional(),
    since: isoTimestamp.optional().describe("ISO timestamp lower bound"),
    until: isoTimestamp.optional().describe("ISO timestamp upper bound"),
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
