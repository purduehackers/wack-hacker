import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { DISCORD_GUILD_ID } from "../../../protocol/constants.ts";
import { approval } from "../../approvals/index.ts";
import { discord } from "./client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHANNEL_TYPE_NAMES: Record<number, string> = {
  10: "announcement_thread",
  11: "public_thread",
  12: "private_thread",
};

function summarizeThread(thread: any) {
  return {
    id: thread.id,
    name: thread.name,
    parentId: thread.parent_id ?? null,
    archived: thread.thread_metadata?.archived ?? false,
    locked: thread.thread_metadata?.locked ?? false,
    autoArchiveDuration: thread.thread_metadata?.auto_archive_duration ?? null,
    messageCount: thread.message_count ?? 0,
    memberCount: thread.member_count ?? 0,
    createdAt: thread.thread_metadata?.create_timestamp ?? null,
    type: CHANNEL_TYPE_NAMES[thread.type] ?? `unknown(${thread.type})`,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const list_threads = tool({
  description:
    "List active threads in the server or archived threads in a specific channel. Use channel_id with include_archived to get archived threads from a particular channel.",
  inputSchema: z.object({
    channel_id: z
      .string()
      .optional()
      .describe("Channel ID to list threads from (omit for all active server threads)"),
    include_archived: z
      .boolean()
      .default(false)
      .describe("Include archived threads (only works with channel_id)"),
  }),
  execute: async ({ channel_id, include_archived }) => {
    if (channel_id) {
      // Get active threads for the guild, then filter by channel
      const active = (await discord.get(Routes.guildActiveThreads(DISCORD_GUILD_ID))) as any;
      const channelThreads = (active.threads ?? []).filter((t: any) => t.parent_id === channel_id);
      const threads = channelThreads.map(summarizeThread);

      if (include_archived) {
        const publicArchived = (await discord.get(
          `${Routes.channelThreads(channel_id, "public")}/archived`,
        )) as any;
        if (publicArchived?.threads) {
          threads.push(...publicArchived.threads.map(summarizeThread));
        }
      }

      return JSON.stringify(threads);
    }

    // All active threads in the guild
    const active = (await discord.get(Routes.guildActiveThreads(DISCORD_GUILD_ID))) as any;
    return JSON.stringify((active.threads ?? []).map(summarizeThread));
  },
});

export const create_thread = tool({
  description:
    "Create a new thread in a channel. Can be a standalone thread or start from an existing message. Supports public and private thread types.",
  inputSchema: z.object({
    channel_id: z.string().describe("Channel ID to create the thread in"),
    name: z.string().describe("Thread name"),
    message_id: z
      .string()
      .optional()
      .describe("Message ID to start the thread from (omit for standalone thread)"),
    auto_archive_duration: z
      .enum(["60", "1440", "4320", "10080"])
      .optional()
      .describe(
        "Auto-archive after minutes of inactivity: 60 (1h), 1440 (1d), 4320 (3d), 10080 (7d)",
      ),
    type: z
      .enum(["public", "private"])
      .default("public")
      .describe("Thread type (public or private)"),
    slowmode: z.number().optional().describe("Slowmode delay in seconds (0 to disable)"),
    invitable: z
      .boolean()
      .optional()
      .describe("Whether non-moderators can invite others (private threads only)"),
  }),
  execute: async ({
    channel_id,
    name,
    message_id,
    auto_archive_duration,
    type,
    slowmode,
    invitable,
  }) => {
    const body: Record<string, any> = { name };
    if (auto_archive_duration) body.auto_archive_duration = Number(auto_archive_duration);
    if (slowmode !== undefined) body.rate_limit_per_user = slowmode;

    if (message_id) {
      // Start thread from a message
      const thread = (await discord.post(Routes.threads(channel_id, message_id), { body })) as any;
      return JSON.stringify(summarizeThread(thread));
    }

    // Standalone thread
    body.type = type === "private" ? 12 : 11; // 12=private, 11=public
    if (invitable !== undefined && type === "private") body.invitable = invitable;

    const thread = (await discord.post(Routes.threads(channel_id), {
      body,
    })) as any;
    return JSON.stringify(summarizeThread(thread));
  },
});

export const edit_thread = tool({
  description:
    "Edit a thread's settings including name, archived/locked state, auto-archive duration, slowmode, and invitability.",
  inputSchema: z.object({
    thread_id: z.string().describe("Thread ID"),
    name: z.string().optional().describe("New thread name"),
    archived: z.boolean().optional().describe("Archive or unarchive the thread"),
    locked: z
      .boolean()
      .optional()
      .describe("Lock or unlock the thread (prevents non-moderators from unarchiving)"),
    auto_archive_duration: z
      .enum(["60", "1440", "4320", "10080"])
      .optional()
      .describe("Auto-archive after minutes of inactivity"),
    slowmode: z.number().optional().describe("Slowmode delay in seconds (0 to disable)"),
    invitable: z
      .boolean()
      .optional()
      .describe("Whether non-moderators can invite others to the thread (private threads only)"),
  }),
  execute: async ({
    thread_id,
    name,
    archived,
    locked,
    auto_archive_duration,
    slowmode,
    invitable,
  }) => {
    const body: Record<string, any> = {};
    if (name) body.name = name;
    if (archived !== undefined) body.archived = archived;
    if (locked !== undefined) body.locked = locked;
    if (auto_archive_duration) body.auto_archive_duration = Number(auto_archive_duration);
    if (slowmode !== undefined) body.rate_limit_per_user = slowmode;
    if (invitable !== undefined) body.invitable = invitable;

    const edited = (await discord.patch(Routes.channel(thread_id), {
      body,
    })) as any;
    return JSON.stringify(summarizeThread(edited));
  },
});

export const delete_thread = approval(
  tool({
    description:
      "Delete a thread. This is irreversible and will permanently remove the thread and all its messages.",
    inputSchema: z.object({
      thread_id: z.string().describe("Thread ID to delete"),
    }),
    execute: async ({ thread_id }) => {
      const thread = (await discord.delete(Routes.channel(thread_id))) as any;
      return JSON.stringify({ success: true, deleted: thread.name });
    },
  }),
);
