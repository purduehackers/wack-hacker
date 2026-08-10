import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const disable_email_routing = defineTool({
  description:
    "Turn Email Routing off for a zone. All inbound mail to the domain stops being forwarded immediately.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) =>
    JSON.stringify(await cloudflare().emailRouting.disable({ zone_id, body: {} })),
});
