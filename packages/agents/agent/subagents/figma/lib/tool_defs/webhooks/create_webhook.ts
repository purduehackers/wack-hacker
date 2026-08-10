import type { PostWebhookRequestBody, WebhookV2 } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { summarizeWebhook, webhookEventSchema } from "../../constants.ts";

export const create_webhook = defineTool({
  description:
    "Create a new webhook for team events. Events include FILE_UPDATE, FILE_DELETE, FILE_VERSION_UPDATE, LIBRARY_PUBLISH, and more.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    event_type: webhookEventSchema.describe("The event type to subscribe to"),
    endpoint: z.url().describe("The callback URL"),
    passcode: z.string().describe("Passcode for verifying webhook payloads"),
    description: z.string().optional().describe("Description of the webhook"),
  }),
  execute: async ({ event_type, endpoint, passcode, description }) => {
    const body: PostWebhookRequestBody = {
      event_type,
      context: "team",
      context_id: figma.teamId,
      endpoint,
      passcode,
    };
    if (description) body.description = description;
    const result = await figma.post<WebhookV2>("/v2/webhooks", body);
    return summarizeWebhook(result);
  },
});
