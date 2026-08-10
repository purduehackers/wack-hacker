import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const list_domains = defineTool({
  description:
    "List verified sending domains on Resend. Returns domain name, region, status (pending, verified, failed), and created date.",
  access: { risk: "read" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({}),
  execute: async () => {
    const result = await resend().domains.list();
    if (result.error) return { error: result.error.message };
    return result.data?.data ?? [];
  },
});
