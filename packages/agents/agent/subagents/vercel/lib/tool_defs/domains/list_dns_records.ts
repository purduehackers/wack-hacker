import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { numericString, TEAM } from "../../constants.ts";

export const list_dns_records = defineTool({
  description: "List DNS records for a domain managed by Vercel nameservers.",
  access: { risk: "read" },
  input: z.strictObject({
    domain: z.hostname(),
    limit: numericString.optional(),
    since: numericString.optional().describe("JavaScript timestamp (ms) lower bound"),
    until: numericString.optional().describe("JavaScript timestamp (ms) upper bound"),
  }),
  execute: async ({ domain, ...query }) => {
    const result = await vercel().dns.getRecords({ ...TEAM, domain, ...query });
    return JSON.stringify(result);
  },
});
