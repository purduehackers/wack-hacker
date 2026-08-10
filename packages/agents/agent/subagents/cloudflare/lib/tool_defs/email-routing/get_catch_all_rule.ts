import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const get_catch_all_rule = defineTool({
  description:
    "Read the catch-all rule — what happens to mail for any address on the domain that no other rule matched.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) =>
    JSON.stringify(await cloudflare().emailRouting.rules.catchAlls.get({ zone_id })),
});
