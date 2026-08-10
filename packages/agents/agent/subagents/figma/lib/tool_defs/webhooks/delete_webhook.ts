import type { WebhookV2 } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { summarizeWebhook } from "../../constants.ts";

export const delete_webhook = defineTool({
  description: "Delete a webhook permanently.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    webhook_id: z.string().describe("The webhook ID to delete"),
  }),
  execute: async ({ webhook_id }) => {
    const result = await figma.delete<WebhookV2>(`/v2/webhooks/${webhook_id}`);
    return summarizeWebhook(result);
  },
});
