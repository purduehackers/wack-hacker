import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_webhook = defineTool({
  description: "Delete a team webhook.",
  access: { risk: "destructive" },
  input: z.strictObject({ webhook_id: z.string() }),
  execute: async ({ webhook_id }) => {
    await vercel().webhooks.deleteWebhook({ ...TEAM, id: webhook_id });
    return JSON.stringify({ ok: true, id: webhook_id });
  },
});
