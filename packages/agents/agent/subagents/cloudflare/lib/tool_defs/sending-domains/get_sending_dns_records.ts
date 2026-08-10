import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const get_sending_dns_records = defineTool({
  description:
    "Show the SPF, DKIM and DMARC records a sending domain requires, so they can be created with create_dns_record.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId, subdomain_id: z.string().min(1) }),
  execute: async ({ zone_id, subdomain_id }) => {
    const page = await cloudflare().emailSending.subdomains.dns.get(subdomain_id, { zone_id });
    return JSON.stringify(page.result);
  },
});
