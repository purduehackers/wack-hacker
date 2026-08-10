import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const list_broadcasts = defineTool({
  description:
    "List Resend broadcasts (mass email campaigns). Returns each broadcast's id, name, status, audience, scheduled_at, and created_at.",
  access: { risk: "read" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({}),
  execute: async () => {
    const result = await resend().broadcasts.list();
    if (result.error) return { error: result.error.message };
    return result.data?.data ?? [];
  },
});
