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
            pattern: z.string().describe("Role name pattern to search for (case-insensitive)"),
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
            pattern: z.string().describe("Channel name pattern to search for (case-insensitive)"),
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

    getRoleInfo: tool({
        description:
            "Get detailed information about a specific role by ID or exact name. Use this after searchRoles to get more details.",
        inputSchema: z.object({
            identifier: z.string().describe("Role ID or exact role name"),
        }),
        execute: async ({ identifier }) => {
            const role =
                guild.roles.cache.get(identifier) ??
                guild.roles.cache.find((r) => r.name.toLowerCase() === identifier.toLowerCase());

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

    getRoleMembers: tool({
        description:
            "Get a sample of members who have a specific role. Useful for understanding who has a role before modifying it.",
        inputSchema: z.object({
            roleId: z.string().describe("The role ID to get members for"),
            limit: z
                .number()
                .min(1)
                .max(25)
                .optional()
                .describe("Maximum number of members to return (default: 10)"),
        }),
        execute: async ({ roleId, limit = 10 }) => {
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                return { error: `Role not found: ${roleId}` };
            }

            const members = role.members.first(limit);
            return {
                roleId: role.id,
                roleName: role.name,
                totalMemberCount: role.members.size,
                sampleMembers:
                    members?.map((m) => ({
                        id: m.id,
                        username: m.user.username,
                        displayName: m.displayName,
                        joinedAt: m.joinedAt?.toISOString() ?? null,
                    })) ?? [],
            };
        },
    }),

    countMembersByJoinDate: tool({
        description:
            "Count members who joined after a specific date. Useful for bulk operations based on join date.",
        inputSchema: z.object({
            after: z
                .string()
                .describe(
                    "ISO date string (e.g., '2026-01-01') - count members who joined after this date",
                ),
            roleId: z.string().optional().describe("Optional: only count members with this role"),
        }),
        execute: async ({ after, roleId }) => {
            const cutoffDate = new Date(after);
            if (Number.isNaN(cutoffDate.getTime())) {
                return { error: `Invalid date: ${after}` };
            }

            const members = await guild.members.fetch();
            let filtered = members.filter((m) => m.joinedAt && m.joinedAt >= cutoffDate);

            if (roleId) {
                filtered = filtered.filter((m) => m.roles.cache.has(roleId));
            }

            return {
                after,
                roleId: roleId ?? null,
                count: filtered.size,
                sampleMembers:
                    filtered.first(5)?.map((m) => ({
                        id: m.id,
                        username: m.user.username,
                        joinedAt: m.joinedAt?.toISOString() ?? null,
                    })) ?? [],
            };
        },
    }),

    listRoles: tool({
        description:
            "List all roles in the server, sorted by position. Use this to understand the role hierarchy.",
        inputSchema: z.object({
            limit: z
                .number()
                .min(1)
                .max(50)
                .optional()
                .describe("Maximum number of roles to return (default: 25)"),
        }),
        execute: async ({ limit = 25 }) => {
            const roles = guild.roles.cache.sort((a, b) => b.position - a.position).first(limit);

            return (
                roles?.map((r) => ({
                    id: r.id,
                    name: r.name,
                    color: r.hexColor,
                    memberCount: r.members.size,
                    position: r.position,
                })) ?? []
            );
        },
    }),

    searchUsers: tool({
        description:
            "Search for users/members by username or display name. Returns matching members.",
        inputSchema: z.object({
            pattern: z.string().describe("Username or display name pattern to search for"),
            limit: z
                .number()
                .min(1)
                .max(25)
                .optional()
                .describe("Maximum number of results (default: 10)"),
        }),
        execute: async ({ pattern, limit = 10 }) => {
            const members = await guild.members.fetch();
            const patternLower = pattern.toLowerCase();

            const matched = members
                .filter(
                    (m) =>
                        m.user.username.toLowerCase().includes(patternLower) ||
                        m.displayName.toLowerCase().includes(patternLower),
                )
                .first(limit);

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
});

export type DiscordTools = ReturnType<typeof createDiscordTools>;
