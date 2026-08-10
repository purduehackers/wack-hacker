import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { ruleId, zoneId } from "../../constants.ts";

export const delete_routing_rule = defineTool({
  description:
    "Delete an Email Routing rule. Mail to that address then falls through to the catch-all, which may be a drop — read get_catch_all_rule before deleting so you can say where the mail will actually go.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ zone_id: zoneId, rule_id: ruleId }),
  execute: async ({ zone_id, rule_id }) =>
    JSON.stringify(await cloudflare().emailRouting.rules.delete(rule_id, { zone_id })),
});
