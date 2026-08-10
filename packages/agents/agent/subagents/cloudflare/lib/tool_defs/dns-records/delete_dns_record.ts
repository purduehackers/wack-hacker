import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const delete_dns_record = defineTool({
  description:
    "Permanently delete a DNS record. Deleting an MX, SPF, DKIM or DMARC record breaks mail for the whole domain — read the record back with get_dns_record and say what it is before deleting.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ zone_id: zoneId, record_id: z.string().min(1) }),
  execute: async ({ zone_id, record_id }) =>
    JSON.stringify(await cloudflare().dns.records.delete(record_id, { zone_id })),
});
