import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const enable_email_routing = defineTool({
  description:
    "Turn Email Routing on for a zone. This takes over the zone's MX records — any existing mail provider on that domain stops receiving mail.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) =>
    JSON.stringify(await cloudflare().emailRouting.enable({ zone_id, body: {} })),
});
