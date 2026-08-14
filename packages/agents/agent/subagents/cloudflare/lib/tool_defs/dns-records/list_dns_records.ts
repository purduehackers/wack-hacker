import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { recordType, zoneId } from "../../constants.ts";

export const list_dns_records = defineTool({
  description:
    "List DNS records in a zone. Supports filtering by name and type, which is the fast way to answer 'what are the MX records' without paging the whole zone.",
  access: { risk: "read" },
  input: z.strictObject({
    zone_id: zoneId,
    name: z.string().optional().describe("Exact record name to filter by"),
    type: recordType.optional(),
    per_page: z.int().min(1).max(100).default(50),
  }),
  execute: async ({ zone_id, name, type, per_page }) => {
    const page = await cloudflare().dns.records.list({
      zone_id,
      per_page,
      ...(name !== undefined && { name: { exact: name } }),
      ...(type !== undefined && { type }),
    });
    return JSON.stringify(page.result);
  },
});
