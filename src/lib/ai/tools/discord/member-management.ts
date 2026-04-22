import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { DISCORD_GUILD_ID } from "../../../protocol/constants.ts";
import { admin } from "../../skills/index.ts";
import { discord } from "./client.ts";

// destructive
export const ban_member = admin(
  tool({
    description:
      "Ban a member from the Discord server. They cannot rejoin until unbanned. Optionally delete the last N seconds of their messages (0-604800, 0 by default).",
    inputSchema: z.object({
      member_id: z.string().describe("Discord user ID to ban"),
      delete_message_seconds: z
        .number()
        .min(0)
        .max(604_800)
        .optional()
        .describe("Seconds of recent messages to delete (max 604800 = 7 days)"),
      reason: z.string().optional().describe("Audit log reason"),
    }),
    execute: async ({ member_id, delete_message_seconds, reason }) => {
      await discord.put(Routes.guildBan(DISCORD_GUILD_ID, member_id), {
        body: { delete_message_seconds: delete_message_seconds ?? 0 },
        reason: reason ?? undefined,
      });
      return JSON.stringify({ banned: true, member_id });
    },
  }),
);

export const unban_member = admin(
  tool({
    description: "Remove a ban for a Discord user, allowing them to rejoin the server.",
    inputSchema: z.object({
      user_id: z.string().describe("Discord user ID to unban"),
      reason: z.string().optional().describe("Audit log reason"),
    }),
    execute: async ({ user_id, reason }) => {
      await discord.delete(Routes.guildBan(DISCORD_GUILD_ID, user_id), {
        reason: reason ?? undefined,
      });
      return JSON.stringify({ unbanned: true, user_id });
    },
  }),
);

export const list_bans = admin(
  tool({
    description:
      "List banned users in the Discord server. Returns user ID, username, and ban reason. Paginated via before/after cursors (snowflake IDs).",
    inputSchema: z.object({
      limit: z.number().max(1000).optional().describe("Max bans to return (default 100)"),
      before: z.string().optional().describe("Return bans before this user ID"),
      after: z.string().optional().describe("Return bans after this user ID"),
    }),
    execute: async ({ limit, before, after }) => {
      const params = new URLSearchParams({ limit: String(limit ?? 100) });
      if (before) params.set("before", before);
      if (after) params.set("after", after);
      const bans = (await discord.get(Routes.guildBans(DISCORD_GUILD_ID), {
        query: params,
      })) as Array<{
        user: { id: string; username: string; global_name: string | null };
        reason: string | null;
      }>;
      return JSON.stringify(
        bans.map((b) => ({
          userId: b.user.id,
          username: b.user.global_name ?? b.user.username,
          reason: b.reason,
        })),
      );
    },
  }),
);

// destructive
export const kick_member = admin(
  tool({
    description:
      "Kick a member from the Discord server. They can rejoin via a new invite. For permanent removal, use ban_member instead.",
    inputSchema: z.object({
      member_id: z.string().describe("Discord user ID to kick"),
      reason: z.string().optional().describe("Audit log reason"),
    }),
    execute: async ({ member_id, reason }) => {
      await discord.delete(Routes.guildMember(DISCORD_GUILD_ID, member_id), {
        reason: reason ?? undefined,
      });
      return JSON.stringify({ kicked: true, member_id });
    },
  }),
);

// destructive
export const timeout_member = admin(
  tool({
    description:
      "Timeout a member. They cannot send messages, react, speak, or join voice until the timeout expires. Max duration is 28 days.",
    inputSchema: z.object({
      member_id: z.string().describe("Discord user ID to timeout"),
      duration_seconds: z
        .number()
        .min(1)
        .max(2_419_200)
        .describe("Timeout duration in seconds (max 2419200 = 28 days)"),
      reason: z.string().optional().describe("Audit log reason"),
    }),
    execute: async ({ member_id, duration_seconds, reason }) => {
      const until = new Date(Date.now() + duration_seconds * 1000).toISOString();
      await discord.patch(Routes.guildMember(DISCORD_GUILD_ID, member_id), {
        body: { communication_disabled_until: until },
        reason: reason ?? undefined,
      });
      return JSON.stringify({ timeout_until: until, member_id });
    },
  }),
);

// destructive
export const clear_timeout = admin(
  tool({
    description:
      "Clear an active timeout on a member, restoring their ability to talk immediately.",
    inputSchema: z.object({
      member_id: z.string().describe("Discord user ID"),
      reason: z.string().optional().describe("Audit log reason"),
    }),
    execute: async ({ member_id, reason }) => {
      await discord.patch(Routes.guildMember(DISCORD_GUILD_ID, member_id), {
        body: { communication_disabled_until: null },
        reason: reason ?? undefined,
      });
      return JSON.stringify({ timeout_cleared: true, member_id });
    },
  }),
);
