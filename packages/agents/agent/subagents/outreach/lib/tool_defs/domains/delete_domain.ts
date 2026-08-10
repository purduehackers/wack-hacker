import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const delete_domain = defineTool({
  description:
    "Permanently delete a Resend domain. All sending from that domain stops immediately.",
  access: { risk: "destructive", minRole: "admin" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    domain_id: z.string().describe("Resend domain ID"),
  }),
  execute: async ({ domain_id }) => {
    const result = await resend().domains.remove(domain_id);
    if (result.error) return { error: result.error.message };
    return { deleted: true, domain_id };
  },
});
