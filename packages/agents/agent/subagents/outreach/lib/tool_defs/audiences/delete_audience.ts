import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const delete_audience = defineTool({
  description:
    "Delete a Resend segment (audience). Contacts in the segment are not deleted; they lose their segment membership.",
  access: { risk: "destructive" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    audience_id: z.string().describe("Resend segment ID"),
  }),
  execute: async ({ audience_id }) => {
    const result = await resend().segments.remove(audience_id);
    if (result.error) return { error: result.error.message };
    return { deleted: true, audience_id };
  },
});
