import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const create_audience = defineTool({
  description: "Create a new Resend segment (audience).",
  access: { risk: "write" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    name: z.string().describe("Segment name"),
  }),
  execute: async ({ name }) => {
    const result = await resend().segments.create({ name });
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});
