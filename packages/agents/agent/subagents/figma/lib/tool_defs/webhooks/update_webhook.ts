import type { PutWebhookRequestBody, WebhookV2, WebhookV2Status } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { summarizeWebhook, webhookEventSchema } from "../../constants.ts";

const webhookStatusSchema = z.enum(["ACTIVE", "PAUSED"]) satisfies z.ZodType<WebhookV2Status>;

export const update_webhook = defineTool({
  description: "Update webhook configuration — endpoint, passcode, description, or status.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    webhook_id: z.string().describe("The webhook ID"),
    event_type: webhookEventSchema.describe("The event type"),
    endpoint: z.url().describe("Callback URL"),
    passcode: z.string().describe("Passcode for verification"),
    description: z.string().optional().describe("New description"),
    status: webhookStatusSchema.optional().describe("Webhook status"),
  }),
  execute: async ({ webhook_id, event_type, endpoint, passcode, description, status }) => {
    const body: PutWebhookRequestBody = {
      event_type,
      endpoint,
      passcode,
    };
    if (description) body.description = description;
    if (status) body.status = status;
    const result = await figma.put<WebhookV2>(`/v2/webhooks/${webhook_id}`, body);
    return summarizeWebhook(result);
  },
});
