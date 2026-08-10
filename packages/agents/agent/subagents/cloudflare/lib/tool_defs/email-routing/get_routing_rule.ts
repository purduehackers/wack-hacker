import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { ruleId, zoneId } from "../../constants.ts";

export const get_routing_rule = defineTool({
  description: "Retrieve one Email Routing rule by id.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId, rule_id: ruleId }),
  execute: async ({ zone_id, rule_id }) =>
    JSON.stringify(await cloudflare().emailRouting.rules.get(rule_id, { zone_id })),
});
