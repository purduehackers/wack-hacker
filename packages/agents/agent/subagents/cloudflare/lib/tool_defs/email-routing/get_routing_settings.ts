import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const get_routing_settings = defineTool({
  description:
    "Read Email Routing status for a zone — whether it is enabled, and whether the required MX records are in place.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) => JSON.stringify(await cloudflare().emailRouting.get({ zone_id })),
});
