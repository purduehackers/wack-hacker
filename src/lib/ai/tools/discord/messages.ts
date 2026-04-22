import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { discord } from "./client.ts";

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const send_message = approval(
  tool({
    description:
      "Send a message to a channel. Supports Discord markdown formatting. Returns the sent message's ID, channel ID, and content.",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel ID to send the message to"),
      content: z.string().describe("Message content (supports Discord markdown)"),
    }),
    execute: async ({ channel_id, content }) => {
      const msg = (await discord.post(Routes.channelMessages(channel_id), {
        body: { content },
      })) as any;
      return JSON.stringify({
        id: msg.id,
        channelId: msg.channel_id,
        content: msg.content,
      });
    },
  }),
);

export const delete_message = approval(
  tool({
    description:
      "Delete a message from a channel. Requires the message ID and channel ID. This is irreversible.",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel ID"),
      message_id: z.string().describe("Message ID to delete"),
    }),
    execute: async ({ channel_id, message_id }) => {
      await discord.delete(Routes.channelMessage(channel_id, message_id));
      return JSON.stringify({ success: true, deleted: message_id });
    },
  }),
);

export const pin_message = tool({
  description:
    "Pin a message in a channel. Pinned messages appear in the channel's pinned messages panel for easy reference.",
  inputSchema: z.object({
    channel_id: z.string().describe("Channel ID"),
    message_id: z.string().describe("Message ID to pin"),
  }),
  execute: async ({ channel_id, message_id }) => {
    await discord.put(Routes.channelPin(channel_id, message_id));
    return JSON.stringify({ success: true, pinned: message_id });
  },
});

export const unpin_message = approval(
  tool({
    description:
      "Unpin a message in a channel. Removes the message from the channel's pinned messages panel.",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel ID"),
      message_id: z.string().describe("Message ID to unpin"),
    }),
    execute: async ({ channel_id, message_id }) => {
      await discord.delete(Routes.channelPin(channel_id, message_id));
      return JSON.stringify({ success: true, unpinned: message_id });
    },
  }),
);

export const add_reaction = tool({
  description:
    "Add a reaction emoji to a message. Use Unicode emoji characters (e.g. '\u{1F44D}') or custom emoji in the format 'name:id' (e.g. 'custom_emoji:123456789').",
  inputSchema: z.object({
    channel_id: z.string().describe("Channel ID"),
    message_id: z.string().describe("Message ID"),
    emoji: z
      .string()
      .describe("Emoji to react with (Unicode emoji or custom emoji in 'name:id' format)"),
  }),
  execute: async ({ channel_id, message_id, emoji }) => {
    // URL-encode the emoji for the API path
    const encoded = encodeURIComponent(emoji);
    await discord.put(Routes.channelMessageOwnReaction(channel_id, message_id, encoded));
    return JSON.stringify({ success: true, reacted: emoji });
  },
});

export const get_message = tool({
  description:
    "Get a single message by channel ID and message ID. Returns the message content, author, timestamps, attachments, embeds, and pin status.",
  inputSchema: z.object({
    channel_id: z.string().describe("Channel ID"),
    message_id: z.string().describe("Message ID"),
  }),
  execute: async ({ channel_id, message_id }) => {
    const m = (await discord.get(Routes.channelMessage(channel_id, message_id))) as any;
    return JSON.stringify({
      id: m.id,
      author: m.author.global_name ?? m.author.username,
      authorId: m.author.id,
      content: m.content,
      timestamp: m.timestamp,
      editedTimestamp: m.edited_timestamp,
      pinned: m.pinned,
      attachments: (m.attachments ?? []).map((a: any) => ({ name: a.filename, url: a.url })),
    });
  },
});

export const edit_message = approval(
  tool({
    description:
      "Edit a message the bot sent. Only the bot's own messages can be edited. Replaces the content entirely.",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel ID"),
      message_id: z.string().describe("Message ID (must be sent by this bot)"),
      content: z.string().describe("New message content"),
    }),
    execute: async ({ channel_id, message_id, content }) => {
      const msg = (await discord.patch(Routes.channelMessage(channel_id, message_id), {
        body: { content },
      })) as any;
      return JSON.stringify({ id: msg.id, content: msg.content });
    },
  }),
);

export const bulk_delete_messages = approval(
  tool({
    description:
      "Bulk delete 2-100 messages from a channel in a single call. Messages must be less than 14 days old. Irreversible.",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel ID"),
      message_ids: z.array(z.string()).min(2).max(100).describe("Message IDs to delete (2-100)"),
    }),
    execute: async ({ channel_id, message_ids }) => {
      await discord.post(Routes.channelBulkDelete(channel_id), {
        body: { messages: message_ids },
      });
      return JSON.stringify({ deleted: message_ids.length, message_ids });
    },
  }),
);

export const crosspost_message = tool({
  description:
    "Publish (crosspost) a message in an announcement channel so it's sent to following channels.",
  inputSchema: z.object({
    channel_id: z.string().describe("Announcement channel ID"),
    message_id: z.string().describe("Message ID to crosspost"),
  }),
  execute: async ({ channel_id, message_id }) => {
    const msg = (await discord.post(Routes.channelMessageCrosspost(channel_id, message_id))) as any;
    return JSON.stringify({ id: msg.id, crossposted: true });
  },
});

export const remove_reaction = approval(
  tool({
    description:
      "Remove a specific user's reaction from a message. Pass '@me' for the bot's own reaction.",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel ID"),
      message_id: z.string().describe("Message ID"),
      emoji: z.string().describe("Emoji (Unicode or name:id format)"),
      user_id: z.string().describe("User ID whose reaction to remove, or '@me' for bot"),
    }),
    execute: async ({ channel_id, message_id, emoji, user_id }) => {
      const encoded = encodeURIComponent(emoji);
      if (user_id === "@me") {
        await discord.delete(Routes.channelMessageOwnReaction(channel_id, message_id, encoded));
      } else {
        await discord.delete(
          Routes.channelMessageUserReaction(channel_id, message_id, encoded, user_id),
        );
      }
      return JSON.stringify({ removed: true });
    },
  }),
);

export const remove_all_reactions = approval(
  tool({
    description: "Remove every reaction from a message. Irreversible.",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel ID"),
      message_id: z.string().describe("Message ID"),
    }),
    execute: async ({ channel_id, message_id }) => {
      await discord.delete(Routes.channelMessageAllReactions(channel_id, message_id));
      return JSON.stringify({ cleared: true });
    },
  }),
);

export const fetch_messages = tool({
  description:
    "Fetch recent messages from a channel. Returns messages sorted oldest-first with author info, content, timestamps, attachments, and pin status. Supports pagination via before/after message IDs.",
  inputSchema: z.object({
    channel_id: z.string().describe("Channel ID"),
    limit: z.number().max(100).default(25).describe("Number of messages to fetch (max 100)"),
    before: z
      .string()
      .optional()
      .describe("Fetch messages before this message ID (for pagination)"),
    after: z.string().optional().describe("Fetch messages after this message ID"),
  }),
  execute: async ({ channel_id, limit, before, after }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set("before", before);
    if (after) params.set("after", after);

    const messages = (await discord.get(Routes.channelMessages(channel_id), {
      query: params,
    })) as any[];

    // Sort oldest first
    const sorted = messages.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return JSON.stringify(
      sorted.map((m) => ({
        id: m.id,
        author: m.author.global_name ?? m.author.username,
        authorId: m.author.id,
        isBot: m.author.bot ?? false,
        content: m.content,
        timestamp: m.timestamp,
        pinned: m.pinned,
        attachments: (m.attachments ?? []).map((a: any) => ({
          name: a.filename,
          url: a.url,
        })),
        embeds: (m.embeds ?? []).length,
      })),
    );
  },
});
