import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, pageLimit, TEAM } from "../../constants.ts";

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
