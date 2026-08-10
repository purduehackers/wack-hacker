import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { forwardTo, ruleId, zoneId } from "../../constants.ts";

export const update_routing_rule = defineTool({
  description:
    "Replace an Email Routing rule's match and destinations. The whole rule is overwritten, so pass the full intended state.",
  access: { risk: "write" },
  input: z.strictObject({
    zone_id: zoneId,
    rule_id: ruleId,
    match_address: z.email(),
    forward_to: forwardTo,
    name: z.string().optional(),
    enabled: z.boolean().default(true),
    priority: z.int().min(0).max(2_147_483_647).optional(),
  }),
  execute: async ({ zone_id, rule_id, match_address, forward_to, name, enabled, priority }) =>
    JSON.stringify(
      await cloudflare().emailRouting.rules.update(rule_id, {
        zone_id,
        matchers: [{ type: "literal", field: "to", value: match_address }],
        actions: [{ type: "forward", value: forward_to }],
        enabled,
        ...(name === undefined ? {} : { name }),
        ...(priority === undefined ? {} : { priority }),
      }),
    ),
});
