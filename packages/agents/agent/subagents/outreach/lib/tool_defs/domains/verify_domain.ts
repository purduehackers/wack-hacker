import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const verify_domain = defineTool({
  description:
    "Kick off verification for a Resend domain. DNS records must already be added; this tells Resend to re-check them.",
  access: { risk: "destructive", minRole: "admin" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    domain_id: z.string().describe("Resend domain ID"),
  }),
  execute: async ({ domain_id }) => {
    const result = await resend().domains.verify(domain_id);
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});
