import { tool } from "ai";
import { z } from "zod";

import { admin } from "../../skills/admin.ts";
import { figma } from "./client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeWebhook(w: any) {
  return {
    id: w.id,
    eventType: w.event_type,
    teamId: w.team_id,
    endpoint: w.endpoint,
    status: w.status,
    description: w.description,
    createdAt: w.created_at,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const list_team_webhooks = admin(
  tool({
    description: "List all webhooks configured for the team.",
    inputSchema: z.object({}),
    execute: async () => {
      const data = (await figma.get(`/v2/teams/${figma.teamId}/webhooks`)) as any;
      return JSON.stringify(data.webhooks?.map(summarizeWebhook) ?? []);
    },
  }),
);

export const create_webhook = admin(
  tool({
    description:
      "Create a new webhook for team events. Events include FILE_UPDATE, FILE_DELETE, FILE_VERSION_UPDATE, LIBRARY_PUBLISH, and more.",
    inputSchema: z.object({
      event_type: z.string().describe("The event type to subscribe to"),
      endpoint: z.string().describe("The callback URL"),
      passcode: z.string().optional().describe("Passcode for verifying webhook payloads"),
      description: z.string().optional().describe("Description of the webhook"),
    }),
    execute: async ({ event_type, endpoint, passcode, description }) => {
      const body: Record<string, unknown> = {
        event_type,
        team_id: figma.teamId,
        endpoint,
      };
      if (passcode) body.passcode = passcode;
      if (description) body.description = description;
      const result = await figma.post("/v2/webhooks", body);
      return JSON.stringify(result);
    },
  }),
);

export const get_webhook = admin(
  tool({
    description: "Get a webhook's details by ID.",
    inputSchema: z.object({
      webhook_id: z.string().describe("The webhook ID"),
    }),
    execute: async ({ webhook_id }) => {
      const data = (await figma.get(`/v2/webhooks/${webhook_id}`)) as any;
      return JSON.stringify(summarizeWebhook(data));
    },
  }),
);

export const update_webhook = admin(
  tool({
    description: "Update webhook configuration — endpoint, passcode, description, or status.",
    inputSchema: z.object({
      webhook_id: z.string().describe("The webhook ID"),
      endpoint: z.string().optional().describe("New callback URL"),
      passcode: z.string().optional().describe("New passcode"),
      description: z.string().optional().describe("New description"),
      status: z.enum(["ACTIVE", "PAUSED"]).optional().describe("Webhook status"),
    }),
    execute: async ({ webhook_id, endpoint, passcode, description, status }) => {
      const body: Record<string, unknown> = {};
      if (endpoint) body.endpoint = endpoint;
      if (passcode) body.passcode = passcode;
      if (description) body.description = description;
      if (status) body.status = status;
      const result = await figma.put(`/v2/webhooks/${webhook_id}`, body);
      return JSON.stringify(result);
    },
  }),
);

export const delete_webhook = admin(
  tool({
    description: "Delete a webhook permanently.",
    inputSchema: z.object({
      webhook_id: z.string().describe("The webhook ID to delete"),
    }),
    execute: async ({ webhook_id }) => {
      await figma.delete(`/v2/webhooks/${webhook_id}`);
      return JSON.stringify({ deleted: true });
    },
  }),
);
