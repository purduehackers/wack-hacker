import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const send_broadcast = defineTool({
  description:
    "Dispatch a Resend broadcast to its target audience. Optionally schedule for a future time with scheduled_at (ISO 8601 or natural-language like 'in 1 hour'). Once sent, cannot be undone.",
  access: { risk: "destructive", confirm: "second-party" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    broadcast_id: z.string().describe("Resend broadcast ID"),
    scheduled_at: z
      .string()
      .optional()
      .describe("ISO 8601 timestamp or natural language like 'in 1 hour'"),
  }),
  execute: async ({ broadcast_id, scheduled_at }) => {
    const result = await resend().broadcasts.send(
      broadcast_id,
      scheduled_at === undefined ? {} : { scheduledAt: scheduled_at },
    );
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});
