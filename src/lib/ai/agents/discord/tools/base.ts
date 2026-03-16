import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { env } from "../../../../../env";
import { discord } from "../client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHANNEL_TYPE_NAMES: Record<number, string> = {
  0: "text",
  2: "voice",
  4: "category",
  5: "announcement",
  13: "stage",
  15: "forum",
  10: "announcement_thread",
  11: "public_thread",
  12: "private_thread",
};

function channelTypeName(type: number): string {
  return CHANNEL_TYPE_NAMES[type] ?? `unknown(${type})`;
}

function summarizeChannel(ch: any) {
  return {
    id: ch.id,
    name: ch.name,
    type: channelTypeName(ch.type),
    ...(ch.topic ? { topic: ch.topic } : {}),
    ...(ch.parent_id ? { parentId: ch.parent_id } : {}),
    position: ch.position,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const get_server_info = tool({
  description:
    "Get Discord server overview: name, member count, channel count, role count, and basic settings. Use this to understand the server at a high level.",
  inputSchema: z.object({}),
  execute: async () => {
    const guild = (await discord.get(Routes.guild(env.DISCORD_GUILD_ID), {
      query: new URLSearchParams({ with_counts: "true" }),
    })) as any;
    return JSON.stringify({
      id: guild.id,
      name: guild.name,
      memberCount: guild.approximate_member_count,
      presenceCount: guild.approximate_presence_count,
      ownerId: guild.owner_id,
      description: guild.description,
      icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
      banner: guild.banner
        ? `https://cdn.discordapp.com/banners/${guild.id}/${guild.banner}.png`
        : null,
      boostLevel: guild.premium_tier,
      boostCount: guild.premium_subscription_count,
      verificationLevel: guild.verification_level,
      createdAt: guild.id,
    });
  },
});

export const list_channels = tool({
  description:
    "List all channels in the Discord server, organized by category. Returns channel IDs, names, types, topics, and positions. Use this to find the right channel before sending messages or performing channel operations.",
  inputSchema: z.object({}),
  execute: async () => {
    const channels = (await discord.get(Routes.guildChannels(env.DISCORD_GUILD_ID))) as any[];

    const nonThread = channels.filter((ch) => ![10, 11, 12].includes(ch.type));

    const categories = nonThread
      .filter((ch) => ch.type === 4)
      .sort((a, b) => a.position - b.position);

    const uncategorized = nonThread
      .filter((ch) => ch.type !== 4 && !ch.parent_id)
      .sort((a, b) => a.position - b.position);

    const result: any[] = [];
    for (const cat of categories) {
      const children = nonThread
        .filter((ch) => ch.parent_id === cat.id)
        .sort((a, b) => a.position - b.position);
      result.push({
        category: { id: cat.id, name: cat.name, position: cat.position },
        channels: children.map(summarizeChannel),
      });
    }
    if (uncategorized.length > 0) {
      result.push({
        category: null,
        channels: uncategorized.map(summarizeChannel),
      });
    }
    return JSON.stringify(result);
  },
});

export const list_roles = tool({
  description:
    "List all roles in the Discord server with their colors, positions, and whether they are hoisted or mentionable. Use this to find role IDs before assigning or managing roles.",
  inputSchema: z.object({}),
  execute: async () => {
    const roles = (await discord.get(Routes.guildRoles(env.DISCORD_GUILD_ID))) as any[];
    const sorted = roles.sort((a, b) => b.position - a.position);
    return JSON.stringify(
      sorted.map((r) => ({
        id: r.id,
        name: r.name,
        color: `#${r.color.toString(16).padStart(6, "0")}`,
        position: r.position,
        mentionable: r.mentionable,
        hoist: r.hoist,
        managed: r.managed,
        isEveryone: r.id === env.DISCORD_GUILD_ID,
      })),
    );
  },
});

export const search_members = tool({
  description:
    "Search for server members by name, nickname, or user ID. Returns member info including roles, join date, and display name. Use this to find a user before performing member operations.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Search query (matches username, display name, nickname, or a user ID)"),
    limit: z.number().max(100).default(10).describe("Max results (max 100)"),
  }),
  execute: async ({ query, limit }) => {
    // If the query looks like a Discord user ID, fetch directly
    if (/^\d{17,20}$/.test(query)) {
      try {
        const member = (await discord.get(Routes.guildMember(env.DISCORD_GUILD_ID, query))) as any;
        return JSON.stringify([summarizeMember(member)]);
      } catch {
        return JSON.stringify([]);
      }
    }
    const members = (await discord.get(Routes.guildMembersSearch(env.DISCORD_GUILD_ID), {
      query: new URLSearchParams({ query, limit: String(limit) }),
    })) as any[];
    return JSON.stringify(members.map(summarizeMember));
  },
});

// ---------------------------------------------------------------------------
// Shared member helper (exported for use by other tool files)
// ---------------------------------------------------------------------------

function summarizeMember(m: any) {
  return {
    id: m.user.id,
    username: m.user.username,
    displayName: m.user.global_name ?? m.user.username,
    nickname: m.nick ?? null,
    roles: m.roles ?? [],
    joinedAt: m.joined_at ?? null,
    isBot: m.user.bot ?? false,
  };
}
