import { tool } from "ai";
import { z } from "zod";
import type { Guild, ChannelType } from "discord.js";

/**
 * Creates Discord inspection tools for the code-mode agent.
 * These tools allow the agent to research the server before generating code.
 */
export const createDiscordTools = (guild: Guild) => ({
  searchRoles: tool({
    description:
      "Search for Discord roles by name pattern. Returns matching roles with their IDs, names, colors, and member counts.",
    inputSchema: z.object({
      pattern: z
        .string()
        .describe("Role name pattern to search for (case-insensitive)"),
    }),
    execute: async ({ pattern }) => {
      const roles = guild.roles.cache.filter((r) =>
        r.name.toLowerCase().includes(pattern.toLowerCase()),
      );
      return (
        roles.first(15)?.map((r) => ({
          id: r.id,
          name: r.name,
          color: r.hexColor,
          memberCount: r.members.size,
          position: r.position,
          mentionable: r.mentionable,
        })) ?? []
      );
    },
  }),

  searchChannels: tool({
    description:
      "Search for Discord channels by name pattern. Returns matching channels with their IDs, names, and types.",
    inputSchema: z.object({
      pattern: z
        .string()
        .describe("Channel name pattern to search for (case-insensitive)"),
      type: z
        .enum(["text", "voice", "forum", "category", "all"])
        .optional()
        .describe("Filter by channel type"),
    }),
    execute: async ({ pattern, type }) => {
      let channels = guild.channels.cache.filter((c) =>
        c.name?.toLowerCase().includes(pattern.toLowerCase()),
      );

      if (type && type !== "all") {
        const typeMap: Record<string, ChannelType[]> = {
          text: [0, 5], // GuildText, GuildAnnouncement
          voice: [2, 13], // GuildVoice, GuildStageVoice
          forum: [15], // GuildForum
          category: [4], // GuildCategory
        };
        const allowedTypes = typeMap[type] ?? [];
        channels = channels.filter((c) => allowedTypes.includes(c.type));
      }

      return (
        channels.first(15)?.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          parentId: c.parentId,
        })) ?? []
      );
    },
  }),

  searchUsers: tool({
    description:
      "Search for users/members by username or display name. Returns matching members. Optionally filter by role.",
    inputSchema: z.object({
      pattern: z
        .string()
        .describe("Username or display name pattern to search for"),
      role: z
        .string()
        .optional()
        .describe("Filter by role ID or role name"),
      limit: z
        .number()
        .min(1)
        .max(25)
        .optional()
        .describe("Maximum number of results (default: 10)"),
    }),
    execute: async ({ pattern, role, limit = 10 }) => {
      const members = await guild.members.fetch();
      const patternLower = pattern.toLowerCase();

      let filtered = members.filter(
        (m) =>
          m.user.username.toLowerCase().includes(patternLower) ||
          m.displayName.toLowerCase().includes(patternLower),
      );

      if (role) {
        const roleLower = role.toLowerCase();
        filtered = filtered.filter((m) =>
          m.roles.cache.some(
            (r) => r.id === role || r.name.toLowerCase() === roleLower,
          ),
        );
      }

      const matched = filtered.first(limit);

      return (
        matched?.map((m) => ({
          id: m.id,
          username: m.user.username,
          displayName: m.displayName,
          joinedAt: m.joinedAt?.toISOString() ?? null,
          roleCount: m.roles.cache.size,
        })) ?? []
      );
    },
  }),

  getRoleInfo: tool({
    description:
      "Get detailed information about a specific role by ID or exact name. Use this after searchRoles to get more details.",
    inputSchema: z.object({
      identifier: z.string().describe("Role ID or exact role name"),
    }),
    execute: async ({ identifier }) => {
      const role =
        guild.roles.cache.get(identifier) ??
        guild.roles.cache.find(
          (r) => r.name.toLowerCase() === identifier.toLowerCase(),
        );

      if (!role) {
        return { error: `Role not found: ${identifier}` };
      }

      return {
        id: role.id,
        name: role.name,
        color: role.hexColor,
        memberCount: role.members.size,
        position: role.position,
        mentionable: role.mentionable,
        hoisted: role.hoist,
        managed: role.managed,
        permissions: role.permissions.toArray(),
      };
    },
  }),

  getChannelInfo: tool({
    description:
      "Get detailed information about a specific channel by ID or exact name. Use this after searchChannels to get more details.",
    inputSchema: z.object({
      identifier: z.string().describe("Channel ID or exact channel name"),
    }),
    execute: async ({ identifier }) => {
      const channel =
        guild.channels.cache.get(identifier) ??
        guild.channels.cache.find(
          (c) => c.name?.toLowerCase() === identifier.toLowerCase(),
        );

      if (!channel) {
        return { error: `Channel not found: ${identifier}` };
      }

      const position = "position" in channel ? channel.position : null;

      return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId,
        parentName: channel.parent?.name ?? null,
        position,
      };
    },
  }),

  getUserInfo: tool({
    description:
      "Get detailed information about a specific user/member by ID or username. Use this after searchUsers to get more details.",
    inputSchema: z.object({
      identifier: z.string().describe("User ID or username"),
    }),
    execute: async ({ identifier }) => {
      const members = await guild.members.fetch();
      const identifierLower = identifier.toLowerCase();

      const member =
        members.get(identifier) ??
        members.find(
          (m) =>
            m.user.username.toLowerCase() === identifierLower ||
            m.displayName.toLowerCase() === identifierLower,
        );

      if (!member) {
        return { error: `User not found: ${identifier}` };
      }

      return {
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        discriminator: member.user.discriminator,
        bot: member.user.bot,
        joinedAt: member.joinedAt?.toISOString() ?? null,
        createdAt: member.user.createdAt.toISOString(),
        roles: member.roles.cache.map((r) => ({
          id: r.id,
          name: r.name,
          color: r.hexColor,
        })),
        permissions: member.permissions.toArray(),
        nickname: member.nickname,
        avatarURL: member.displayAvatarURL(),
      };
    },
  }),
});

export type DiscordTools = ReturnType<typeof createDiscordTools>;
