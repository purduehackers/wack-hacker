import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const get_audience = defineTool({
  description: "Get a single Resend segment (audience) by ID.",
  access: { risk: "read" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    audience_id: z.string().describe("Resend segment ID"),
  }),
  execute: async ({ audience_id }) => {
    const result = await resend().segments.get(audience_id);
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});
