import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { forwardTo, zoneId } from "../../constants.ts";

export const create_routing_rule = defineTool({
  description:
    "Forward one address to one or more verified destinations. The destinations must already exist and be verified — create them with create_destination_address first.",
  access: { risk: "write" },
  input: z.strictObject({
    zone_id: zoneId,
    match_address: z
      .email()
      .describe("The address on this domain to match, e.g. hello@example.com"),
    forward_to: forwardTo,
    name: z.string().optional(),
    enabled: z.boolean().default(true),
    priority: z.int().min(0).max(2_147_483_647).optional(),
  }),
  execute: async ({ zone_id, match_address, forward_to, name, enabled, priority }) =>
    JSON.stringify(
      await cloudflare().emailRouting.rules.create({
        zone_id,
        matchers: [{ type: "literal", field: "to", value: match_address }],
        actions: [{ type: "forward", value: forward_to }],
        enabled,
        ...(name === undefined ? {} : { name }),
        ...(priority === undefined ? {} : { priority }),
      }),
    ),
});
