import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { DISCORD_GUILD_ID } from "../../../protocol/constants.ts";
import { approval } from "../../approvals/index.ts";
import { discord } from "./client.ts";

interface Sticker {
  id: string;
  name: string;
  description: string | null;
  tags: string;
  format_type: number;
  available: boolean;
  guild_id?: string;
}

function summarize(s: Sticker) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    tags: s.tags,
    formatType: s.format_type,
    available: s.available,
    url: `https://cdn.discordapp.com/stickers/${s.id}.${s.format_type === 3 ? "json" : "png"}`,
  };
}

export const list_stickers = tool({
  description:
    "List all custom stickers in the Discord server. Returns each sticker's ID, name, description, tags, and URL.",
  inputSchema: z.object({}),
  execute: async () => {
    const stickers = (await discord.get(Routes.guildStickers(DISCORD_GUILD_ID))) as Sticker[];
    return JSON.stringify(stickers.map(summarize));
  },
});

export const create_sticker = tool({
  description:
    "Upload a new custom sticker. Formats: PNG, APNG, or Lottie JSON. Max 512KB, 320x320px recommended. Requires a name (2-30 chars), tag (autocomplete suggestion, 2-200 chars), and image URL.",
  inputSchema: z.object({
    name: z.string().min(2).max(30).describe("Sticker name"),
    description: z.string().max(100).optional().describe("Sticker description"),
    tags: z.string().min(2).max(200).describe("Comma-separated autocomplete suggestions"),
    url: z.string().describe("Image URL (PNG, APNG, or Lottie JSON)"),
  }),
  execute: async ({ name, description, tags, url }) => {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") ?? "image/png";

    const form = new FormData();
    form.append("name", name);
    if (description) form.append("description", description);
    form.append("tags", tags);
    form.append("file", new Blob([buffer], { type: contentType }), "sticker");

    const sticker = (await discord.post(Routes.guildStickers(DISCORD_GUILD_ID), {
      body: form,
      passThroughBody: true,
    })) as Sticker;
    return JSON.stringify(summarize(sticker));
  },
});

export const edit_sticker = tool({
  description: "Edit a custom sticker's name, description, or tag.",
  inputSchema: z.object({
    sticker_id: z.string().describe("Sticker ID"),
    name: z.string().min(2).max(30).optional(),
    description: z.string().max(100).optional(),
    tags: z.string().min(2).max(200).optional(),
  }),
  execute: async ({ sticker_id, ...body }) => {
    const sticker = (await discord.patch(Routes.guildSticker(DISCORD_GUILD_ID, sticker_id), {
      body,
    })) as Sticker;
    return JSON.stringify(summarize(sticker));
  },
});

export const delete_sticker = approval(
  tool({
    description:
      "Delete a custom sticker. Irreversible — all prior uses of the sticker become unresolved references.",
    inputSchema: z.object({
      sticker_id: z.string().describe("Sticker ID to delete"),
    }),
    execute: async ({ sticker_id }) => {
      await discord.delete(Routes.guildSticker(DISCORD_GUILD_ID, sticker_id));
      return JSON.stringify({ deleted: true, sticker_id });
    },
  }),
);
