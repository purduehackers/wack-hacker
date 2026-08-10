import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const update_catch_all_rule = defineTool({
  description:
    "Set the catch-all behavior for a domain: forward everything unmatched to verified destinations, or drop it. Dropping silently discards mail sent to any address without its own rule.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({
    zone_id: zoneId,
    action: z.literal(["forward", "drop"]),
    forward_to: z.array(z.email()).describe("Required when action is forward; ignored for drop"),
    enabled: z.boolean().default(true),
    name: z.string().optional(),
  }),
  execute: async ({ zone_id, action, forward_to, enabled, name }) => {
    if (action === "forward" && forward_to.length === 0) {
      throw new UpstreamError({
        service: "Cloudflare",
        status: 400,
        detail: "forward_to must list at least one destination when action is forward",
      });
    }
    return JSON.stringify(
      await cloudflare().emailRouting.rules.catchAlls.update({
        zone_id,
        matchers: [{ type: "all" }],
        actions: action === "drop" ? [{ type: "drop" }] : [{ type: "forward", value: forward_to }],
        enabled,
        ...(name === undefined ? {} : { name }),
      }),
    );
  },
});
