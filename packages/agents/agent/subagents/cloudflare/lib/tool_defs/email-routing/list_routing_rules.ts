import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { routingRuleListSchema, zoneId } from "../../constants.ts";

export const list_routing_rules = defineTool({
  description:
    "List every Email Routing rule for a zone — which addresses forward where, in priority order. Start here when asked what happens to mail for a given address.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) => {
    // The SDK maps create/get/update/delete for rules but not list, so this one
    // goes through the generic request method. This tool parses the response
    // here rather than trusting whatever the caller declares it to be.
    const raw = await cloudflare().get(`/zones/${zone_id}/email/routing/rules`);
    const parsed = routingRuleListSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UpstreamError({
        service: "Cloudflare",
        status: 502,
        detail: `unexpected rules response: ${z.prettifyError(parsed.error)}`,
      });
    }
    return JSON.stringify(parsed.data.result);
  },
});
