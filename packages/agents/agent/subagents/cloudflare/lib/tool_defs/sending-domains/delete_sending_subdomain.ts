import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const delete_sending_subdomain = defineTool({
  description:
    "Remove a sending domain. Every From address on it stops working immediately, and any service still sending as that domain starts failing.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ zone_id: zoneId, subdomain_id: z.string().min(1) }),
  execute: async ({ zone_id, subdomain_id }) =>
    JSON.stringify(await cloudflare().emailSending.subdomains.delete(subdomain_id, { zone_id })),
});
