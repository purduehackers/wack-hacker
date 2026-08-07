import type {
  GetTeamWebhooksResponse,
  PostWebhookRequestBody,
  PutWebhookRequestBody,
  WebhookV2,
  WebhookV2Event,
  WebhookV2Status,
} from "@figma/rest-api-spec";
import { z } from "zod";

import { figma } from "./client.ts";
import { defineTool } from "./define-tool.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const webhookEventSchema: z.ZodType<WebhookV2Event> = z.enum([
  "PING",
  "FILE_UPDATE",
  "FILE_VERSION_UPDATE",
  "FILE_DELETE",
  "LIBRARY_PUBLISH",
  "FILE_COMMENT",
  "DEV_MODE_STATUS_UPDATE",
]);
const webhookStatusSchema: z.ZodType<WebhookV2Status> = z.enum(["ACTIVE", "PAUSED"]);

function summarizeWebhook(w: WebhookV2) {
  return {
    id: w.id,
    eventType: w.event_type,
    context: w.context,
    contextId: w.context_id,
    endpoint: w.endpoint,
    status: w.status,
    description: w.description,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const list_team_webhooks = defineTool({
  name: "list_team_webhooks",
  domain: "figma",
  description: "List all webhooks configured for the team.",
  access: { risk: "read", minRole: "admin" },
  input: z.object({}),
  execute: async () => {
    const data = await figma.get<GetTeamWebhooksResponse>(`/v2/teams/${figma.teamId}/webhooks`);
    return data.webhooks.map(summarizeWebhook);
  },
});

export const create_webhook = defineTool({
  name: "create_webhook",
  domain: "figma",
  description:
    "Create a new webhook for team events. Events include FILE_UPDATE, FILE_DELETE, FILE_VERSION_UPDATE, LIBRARY_PUBLISH, and more.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
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

export const get_webhook = defineTool({
  name: "get_webhook",
  domain: "figma",
  description: "Get a webhook's details by ID.",
  access: { risk: "read", minRole: "admin" },
  input: z.object({
    webhook_id: z.string().describe("The webhook ID"),
  }),
  execute: async ({ webhook_id }) => {
    const data = await figma.get<WebhookV2>(`/v2/webhooks/${webhook_id}`);
    return summarizeWebhook(data);
  },
});

export const update_webhook = defineTool({
  name: "update_webhook",
  domain: "figma",
  description: "Update webhook configuration — endpoint, passcode, description, or status.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
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

export const delete_webhook = defineTool({
  name: "delete_webhook",
  domain: "figma",
  description: "Delete a webhook permanently.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.object({
    webhook_id: z.string().describe("The webhook ID to delete"),
  }),
  execute: async ({ webhook_id }) => {
    const result = await figma.delete<WebhookV2>(`/v2/webhooks/${webhook_id}`);
    return summarizeWebhook(result);
  },
});
