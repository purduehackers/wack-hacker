import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { env } from "../../../../env.ts";
import { discord } from "./client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeEmoji(e: any) {
  return {
    id: e.id,
    name: e.name,
    animated: e.animated ?? false,
    url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}`,
    roles: e.roles ?? [],
    createdAt: e.id, // Snowflake encodes creation time
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const list_emojis = tool({
  description:
    "List all custom emojis in the server. Returns emoji IDs, names, animation status, image URLs, and role restrictions.",
  inputSchema: z.object({}),
  execute: async () => {
    const emojis = (await discord.get(Routes.guildEmojis(env.DISCORD_GUILD_ID))) as any[];
    return JSON.stringify(emojis.map(summarizeEmoji));
  },
});

export const create_emoji = tool({
  description:
    "Create a custom emoji from an image URL. The image must be PNG, JPG, or GIF and under 256KB. You can restrict usage to specific roles.",
  inputSchema: z.object({
    name: z.string().describe("Emoji name (2-32 characters, alphanumeric and underscores only)"),
    url: z.string().describe("Image URL for the emoji (PNG, JPG, or GIF; max 256KB)"),
    roles: z
      .array(z.string())
      .optional()
      .describe("Role IDs that can use this emoji (omit for everyone)"),
  }),
  execute: async ({ name, url, roles }) => {
    // Fetch the image and convert to base64 data URI
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const contentType = response.headers.get("content-type") ?? "image/png";
    const dataUri = `data:${contentType};base64,${base64}`;

    const body: Record<string, any> = { name, image: dataUri };
    if (roles) body.roles = roles;

    const emoji = (await discord.post(Routes.guildEmojis(env.DISCORD_GUILD_ID), {
      body,
    })) as any;

    return JSON.stringify({
      id: emoji.id,
      name: emoji.name,
      animated: emoji.animated ?? false,
      url: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}`,
    });
  },
});

export const edit_emoji = tool({
  description:
    "Edit a custom emoji's name or role restrictions. Pass an empty roles array to make the emoji available to everyone.",
  inputSchema: z.object({
    emoji_id: z.string().describe("Emoji ID"),
    name: z.string().optional().describe("New emoji name"),
    roles: z
      .array(z.string())
      .optional()
      .describe("New role IDs that can use this emoji (empty array for everyone)"),
  }),
  execute: async ({ emoji_id, name, roles }) => {
    const body: Record<string, any> = {};
    if (name) body.name = name;
    if (roles) body.roles = roles;

    const edited = (await discord.patch(Routes.guildEmoji(env.DISCORD_GUILD_ID, emoji_id), {
      body,
    })) as any;

    return JSON.stringify({
      id: edited.id,
      name: edited.name,
      animated: edited.animated ?? false,
      url: `https://cdn.discordapp.com/emojis/${edited.id}.${edited.animated ? "gif" : "png"}`,
      roles: edited.roles ?? [],
    });
  },
});

export const delete_emoji = tool({
  description:
    "Delete a custom emoji. This is irreversible and will remove the emoji from all messages where it was used (they will show as unknown emoji).",
  inputSchema: z.object({
    emoji_id: z.string().describe("Emoji ID to delete"),
  }),
  execute: async ({ emoji_id }) => {
    // Fetch emoji first to get its name
    const emoji = (await discord.get(Routes.guildEmoji(env.DISCORD_GUILD_ID, emoji_id))) as any;
    await discord.delete(Routes.guildEmoji(env.DISCORD_GUILD_ID, emoji_id));
    return JSON.stringify({ success: true, deleted: emoji.name });
  },
});
