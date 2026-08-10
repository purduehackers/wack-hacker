import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "../../constants.ts";

export const list_event_types = defineTool({
  description:
    "List every user-facing event type the audit log recognises. Use this before calling list_user_events with a specific `types` filter.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await vercel().user.listEventTypes({
      teamId: VERCEL_TEAM_ID,
      slug: VERCEL_TEAM_SLUG,
    });
    return JSON.stringify(result);
  },
});
