import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const remove_dns_record = defineTool({
  description: "Remove a DNS record from a Vercel-managed domain.",
  access: { risk: "destructive" },
  input: z.strictObject({
    domain: z.hostname(),
    record_id: z.string(),
  }),
  execute: async ({ domain, record_id }) => {
    const result = await vercel().dns.removeRecord({ ...TEAM, domain, recordId: record_id });
    return JSON.stringify(result);
  },
});
