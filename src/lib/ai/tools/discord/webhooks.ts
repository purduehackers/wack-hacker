import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { DISCORD_GUILD_ID } from "../../../protocol/constants.ts";
import { discord } from "./client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeWebhook(w: any) {
  return {
    id: w.id,
    name: w.name,
    channelId: w.channel_id,
    url: w.url ?? null,
    avatar: w.avatar ? `https://cdn.discordapp.com/avatars/${w.id}/${w.avatar}.png` : null,
    createdAt: w.id, // Snowflake encodes creation time
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const list_webhooks = tool({
  description:
    "List all webhooks in the server or a specific channel. Returns webhook IDs, names, channel IDs, URLs, and avatars. Useful for auditing or managing integrations.",
  inputSchema: z.object({
    channel_id: z
      .string()
      .optional()
      .describe("Channel ID to filter by (omit for all server webhooks)"),
  }),
  execute: async ({ channel_id }) => {
    const webhooks = channel_id
      ? ((await discord.get(Routes.channelWebhooks(channel_id))) as any[])
      : ((await discord.get(Routes.guildWebhooks(DISCORD_GUILD_ID))) as any[]);

    return JSON.stringify(webhooks.map(summarizeWebhook));
  },
});

export const create_webhook = tool({
  description:
    "Create a webhook in a channel. Webhooks allow external services to send messages to a channel. Returns the webhook details including its URL.",
  inputSchema: z.object({
    channel_id: z.string().describe("Channel ID to create the webhook in"),
    name: z.string().describe("Webhook name"),
    avatar: z.string().optional().describe("Avatar URL for the webhook"),
  }),
  execute: async ({ channel_id, name, avatar }) => {
    const body: Record<string, any> = { name };
    if (avatar) body.avatar = avatar;

    const webhook = (await discord.post(Routes.channelWebhooks(channel_id), {
      body,
    })) as any;

    return JSON.stringify({
      id: webhook.id,
      name: webhook.name,
      channelId: webhook.channel_id,
      url: webhook.url ?? null,
    });
  },
});

export const edit_webhook = tool({
  description: "Edit a webhook's name, avatar, or move it to a different channel.",
  inputSchema: z.object({
    webhook_id: z.string().describe("Webhook ID"),
    name: z.string().optional().describe("New webhook name"),
    avatar: z.string().optional().describe("New avatar URL"),
    channel_id: z.string().optional().describe("Move webhook to a different channel"),
  }),
  execute: async ({ webhook_id, name, avatar, channel_id }) => {
    const body: Record<string, any> = {};
    if (name) body.name = name;
    if (avatar) body.avatar = avatar;
    if (channel_id) body.channel_id = channel_id;

    const edited = (await discord.patch(Routes.webhook(webhook_id), {
      body,
    })) as any;

    return JSON.stringify({
      id: edited.id,
      name: edited.name,
      channelId: edited.channel_id,
      url: edited.url ?? null,
    });
  },
});

// destructive
export const delete_webhook = tool({
  description:
    "Delete a webhook. This is irreversible and will break any integrations using this webhook's URL.",
  inputSchema: z.object({
    webhook_id: z.string().describe("Webhook ID to delete"),
  }),
  execute: async ({ webhook_id }) => {
    // Fetch webhook first to get its name
    const webhook = (await discord.get(Routes.webhook(webhook_id))) as any;
    await discord.delete(Routes.webhook(webhook_id));
    return JSON.stringify({ success: true, deleted: webhook.name });
  },
});
