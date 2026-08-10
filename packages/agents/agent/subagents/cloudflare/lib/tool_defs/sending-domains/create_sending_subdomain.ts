import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const create_sending_subdomain = defineTool({
  description:
    "Onboard a domain for Email Sending. Cloudflare then requires SPF, DKIM and DMARC records under cf-bounce — read them with get_sending_dns_records and create each one before sending.",
  access: { risk: "write" },
  input: z.strictObject({
    zone_id: zoneId,
    name: z.string().min(1).describe("The domain or subdomain to send from; must be in this zone"),
  }),
  execute: async ({ zone_id, name }) =>
    JSON.stringify(await cloudflare().emailSending.subdomains.create({ zone_id, name })),
});
