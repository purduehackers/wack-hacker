import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const get_domain = defineTool({
  description: "Get a single Resend domain by ID, including DNS records and verification status.",
  access: { risk: "read" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    domain_id: z.string().describe("Resend domain ID"),
  }),
  execute: async ({ domain_id }) => {
    const result = await resend().domains.get(domain_id);
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});
