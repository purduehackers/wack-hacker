import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const get_dns_record = defineTool({
  description: "Retrieve one DNS record by id.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId, record_id: z.string().min(1) }),
  execute: async ({ zone_id, record_id }) =>
    JSON.stringify(await cloudflare().dns.records.get(record_id, { zone_id })),
});
