import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const get_routing_dns = defineTool({
  description:
    "Show the DNS records Email Routing needs on a zone, and whether they are currently present and correct.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) =>
    JSON.stringify(await cloudflare().emailRouting.dns.get({ zone_id })),
});
