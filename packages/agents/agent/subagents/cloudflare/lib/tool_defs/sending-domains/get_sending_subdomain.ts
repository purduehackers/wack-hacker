import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const get_sending_subdomain = defineTool({
  description: "Retrieve one sending domain by id, including its verification state.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId, subdomain_id: z.string().min(1) }),
  execute: async ({ zone_id, subdomain_id }) =>
    JSON.stringify(await cloudflare().emailSending.subdomains.get(subdomain_id, { zone_id })),
});
