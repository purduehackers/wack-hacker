import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const list_audiences = defineTool({
  description:
    "List Resend segments (audiences) used for grouping contacts. Returns each segment's id, name, and creation timestamp.",
  access: { risk: "read" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({}),
  execute: async () => {
    const result = await resend().segments.list();
    if (result.error) return { error: result.error.message };
    return result.data?.data ?? [];
  },
});
