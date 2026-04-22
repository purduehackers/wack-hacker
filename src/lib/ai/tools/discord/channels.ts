import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { DISCORD_GUILD_ID } from "../../../protocol/constants.ts";
import { approval } from "../../approvals/index.ts";
import { discord } from "./client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHANNEL_TYPE_MAP: Record<string, number> = {
  text: 0,
  voice: 2,
  category: 4,
  announcement: 5,
  forum: 15,
  stage: 13,
};

const CHANNEL_TYPE_NAMES: Record<number, string> = {
  0: "text",
  2: "voice",
  4: "category",
  5: "announcement",
  13: "stage",
  15: "forum",
};

function summarizeChannel(ch: any) {
  return {
    id: ch.id,
    name: ch.name,
    type: CHANNEL_TYPE_NAMES[ch.type] ?? `unknown(${ch.type})`,
    ...(ch.topic ? { topic: ch.topic } : {}),
    ...(ch.parent_id ? { parentId: ch.parent_id } : {}),
    position: ch.position,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const create_channel = tool({
  description:
    "Create a new channel in the Discord server. Supports text, voice, category, announcement, forum, and stage channel types. Returns the created channel's details.",
  inputSchema: z.object({
    name: z.string().describe("Channel name"),
    type: z
      .enum(["text", "voice", "category", "announcement", "forum", "stage"])
      .default("text")
      .describe("Channel type"),
    topic: z.string().optional().describe("Channel topic (text channels only)"),
    parent_id: z.string().optional().describe("Parent category ID"),
    nsfw: z.boolean().optional().describe("Whether the channel is NSFW"),
    slowmode: z.number().optional().describe("Slowmode delay in seconds (0 to disable)"),
    position: z.number().optional().describe("Channel position within its category"),
    bitrate: z.number().optional().describe("Bitrate in bits/sec for voice channels (e.g. 64000)"),
    user_limit: z.number().optional().describe("Max users for voice channels (0 for unlimited)"),
    rtc_region: z.string().optional().describe("Voice region override for voice channels"),
    video_quality_mode: z
      .enum(["auto", "full"])
      .optional()
      .describe("Video quality mode for voice channels"),
    default_auto_archive_duration: z
      .enum(["60", "1440", "4320", "10080"])
      .optional()
      .describe("Default auto-archive duration for new threads (minutes)"),
    default_thread_slowmode: z
      .number()
      .optional()
      .describe("Default slowmode for new threads in seconds (0 to disable)"),
  }),
  execute: async ({
    name,
    type,
    topic,
    parent_id,
    nsfw,
    slowmode,
    position,
    bitrate,
    user_limit,
    rtc_region,
    video_quality_mode,
    default_auto_archive_duration,
    default_thread_slowmode,
  }) => {
    const body: Record<string, any> = {
      name,
      type: CHANNEL_TYPE_MAP[type] ?? 0,
    };
    if (topic) body.topic = topic;
    if (parent_id) body.parent_id = parent_id;
    if (nsfw !== undefined) body.nsfw = nsfw;
    if (slowmode !== undefined) body.rate_limit_per_user = slowmode;
    if (position !== undefined) body.position = position;
    if (bitrate !== undefined) body.bitrate = bitrate;
    if (user_limit !== undefined) body.user_limit = user_limit;
    if (rtc_region) body.rtc_region = rtc_region;
    if (video_quality_mode) body.video_quality_mode = video_quality_mode === "full" ? 2 : 1;
    if (default_auto_archive_duration)
      body.default_auto_archive_duration = Number(default_auto_archive_duration);
    if (default_thread_slowmode !== undefined)
      body.default_thread_rate_limit_per_user = default_thread_slowmode;

    const channel = (await discord.post(Routes.guildChannels(DISCORD_GUILD_ID), {
      body,
    })) as any;
    return JSON.stringify(summarizeChannel(channel));
  },
});

export const edit_channel = tool({
  description:
    "Edit an existing channel's settings such as name, topic, slowmode, position, NSFW flag, parent category, and voice-specific settings.",
  inputSchema: z.object({
    channel_id: z.string().describe("Channel ID"),
    name: z.string().optional().describe("New channel name"),
    topic: z.string().optional().describe("New channel topic"),
    parent_id: z
      .string()
      .nullable()
      .optional()
      .describe("New parent category ID (null to remove from category)"),
    nsfw: z.boolean().optional().describe("Whether the channel is NSFW"),
    slowmode: z.number().optional().describe("Slowmode delay in seconds (0 to disable)"),
    position: z.number().optional().describe("New position"),
    bitrate: z.number().optional().describe("Bitrate in bits/sec for voice channels (e.g. 64000)"),
    user_limit: z.number().optional().describe("Max users for voice channels (0 for unlimited)"),
    rtc_region: z
      .string()
      .nullable()
      .optional()
      .describe("Voice region override for voice channels (null for automatic)"),
    video_quality_mode: z
      .enum(["auto", "full"])
      .optional()
      .describe("Video quality mode for voice channels"),
    default_auto_archive_duration: z
      .enum(["60", "1440", "4320", "10080"])
      .optional()
      .describe("Default auto-archive duration for new threads (minutes)"),
    default_thread_slowmode: z
      .number()
      .optional()
      .describe("Default slowmode for new threads in seconds (0 to disable)"),
  }),
  execute: async ({
    channel_id,
    name,
    topic,
    parent_id,
    nsfw,
    slowmode,
    position,
    bitrate,
    user_limit,
    rtc_region,
    video_quality_mode,
    default_auto_archive_duration,
    default_thread_slowmode,
  }) => {
    const body: Record<string, any> = {};
    if (name) body.name = name;
    if (topic !== undefined) body.topic = topic;
    if (parent_id !== undefined) body.parent_id = parent_id;
    if (nsfw !== undefined) body.nsfw = nsfw;
    if (slowmode !== undefined) body.rate_limit_per_user = slowmode;
    if (position !== undefined) body.position = position;
    if (bitrate !== undefined) body.bitrate = bitrate;
    if (user_limit !== undefined) body.user_limit = user_limit;
    if (rtc_region !== undefined) body.rtc_region = rtc_region;
    if (video_quality_mode) body.video_quality_mode = video_quality_mode === "full" ? 2 : 1;
    if (default_auto_archive_duration)
      body.default_auto_archive_duration = Number(default_auto_archive_duration);
    if (default_thread_slowmode !== undefined)
      body.default_thread_rate_limit_per_user = default_thread_slowmode;

    const channel = (await discord.patch(Routes.channel(channel_id), {
      body,
    })) as any;
    return JSON.stringify(summarizeChannel(channel));
  },
});

export const get_channel = tool({
  description:
    "Get a single channel's details by ID. Returns type, name, topic, position, parent category, and other settings.",
  inputSchema: z.object({
    channel_id: z.string().describe("Channel ID"),
  }),
  execute: async ({ channel_id }) => {
    const channel = (await discord.get(Routes.channel(channel_id))) as any;
    return JSON.stringify(summarizeChannel(channel));
  },
});

export const follow_announcement_channel = tool({
  description:
    "Follow an announcement channel — its messages will be auto-crossposted to the target channel in this server. Only announcement channels can be followed.",
  inputSchema: z.object({
    source_channel_id: z
      .string()
      .describe("ID of the announcement channel to follow (in any server the bot can see)"),
    target_channel_id: z
      .string()
      .describe("ID of the channel in THIS server that will receive the crossposts"),
  }),
  execute: async ({ source_channel_id, target_channel_id }) => {
    const result = (await discord.post(Routes.channelFollowers(source_channel_id), {
      body: { webhook_channel_id: target_channel_id },
    })) as { channel_id: string; webhook_id: string };
    return JSON.stringify({
      followed: true,
      source: source_channel_id,
      target: result.channel_id,
      webhook_id: result.webhook_id,
    });
  },
});

export const delete_channel = approval(
  tool({
    description:
      "Delete a channel from the server. This is irreversible and will permanently remove the channel and all its messages.",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel ID"),
    }),
    execute: async ({ channel_id }) => {
      const channel = (await discord.delete(Routes.channel(channel_id))) as any;
      return JSON.stringify({ success: true, deleted: channel.name });
    },
  }),
);
