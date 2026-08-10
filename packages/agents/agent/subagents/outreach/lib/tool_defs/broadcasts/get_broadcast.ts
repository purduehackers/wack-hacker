import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const get_broadcast = defineTool({
  description: "Get a single Resend broadcast by ID, including content preview and status.",
  access: { risk: "read" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    broadcast_id: z.string().describe("Resend broadcast ID"),
  }),
  execute: async ({ broadcast_id }) => {
    const result = await resend().broadcasts.get(broadcast_id);
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});
