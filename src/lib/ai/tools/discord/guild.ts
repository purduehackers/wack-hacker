import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { DISCORD_GUILD_ID } from "../../../protocol/constants.ts";
import { admin } from "../../skills/index.ts";
import { discord } from "./client.ts";

export const update_guild = admin(
  tool({
    description:
      "Update core Discord server settings — name, description, icon, banner, afk channel, verification level, etc. Only provide the fields you want to change.",
    inputSchema: z.object({
      name: z.string().optional().describe("Server name"),
      description: z.string().optional().describe("Community description"),
      icon: z.string().nullable().optional().describe("Data URI for icon (null to remove)"),
      banner: z.string().nullable().optional().describe("Data URI for banner (null to remove)"),
      splash: z
        .string()
        .nullable()
        .optional()
        .describe("Data URI for invite splash image (null to remove)"),
      afk_channel_id: z.string().nullable().optional(),
      afk_timeout: z
        .union([z.literal(60), z.literal(300), z.literal(900), z.literal(1800), z.literal(3600)])
        .optional(),
      verification_level: z
        .number()
        .min(0)
        .max(4)
        .optional()
        .describe("0=none, 1=low, 2=medium, 3=high, 4=very_high"),
      default_message_notifications: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("0=all, 1=mentions only"),
      explicit_content_filter: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe("0=disabled, 1=members without role, 2=all members"),
      system_channel_id: z.string().nullable().optional(),
    }),
    execute: async (body) => {
      const guild = (await discord.patch(Routes.guild(DISCORD_GUILD_ID), {
        body,
      })) as { id: string; name: string; description: string | null };
      return JSON.stringify({ id: guild.id, name: guild.name, description: guild.description });
    },
  }),
);

export const get_guild_preview = tool({
  description:
    "Get public preview info for the Discord server — approximate member count, online count, description, features, and splash image.",
  inputSchema: z.object({}),
  execute: async () => {
    const preview = (await discord.get(Routes.guildPreview(DISCORD_GUILD_ID))) as {
      id: string;
      name: string;
      description: string | null;
      approximate_member_count: number;
      approximate_presence_count: number;
      features: string[];
      splash: string | null;
      discovery_splash: string | null;
    };
    return JSON.stringify({
      id: preview.id,
      name: preview.name,
      description: preview.description,
      memberCount: preview.approximate_member_count,
      onlineCount: preview.approximate_presence_count,
      features: preview.features,
    });
  },
});

export const get_vanity_url = tool({
  description:
    "Get the Discord server's vanity invite URL (e.g. discord.gg/purduehackers) if one is configured. Returns code and usage count.",
  inputSchema: z.object({}),
  execute: async () => {
    const data = (await discord.get(Routes.guildVanityUrl(DISCORD_GUILD_ID))) as {
      code: string | null;
      uses: number;
    };
    if (!data.code) return JSON.stringify({ configured: false });
    return JSON.stringify({
      configured: true,
      code: data.code,
      url: `https://discord.gg/${data.code}`,
      uses: data.uses,
    });
  },
});
