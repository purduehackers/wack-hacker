import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { DISCORD_GUILD_ID } from "../../../protocol/constants.ts";
import { discord } from "./client.ts";

export const get_audit_log = tool({
  description:
    "Get the Discord server's audit log. Use to find who performed admin actions (role changes, bans, channel edits, etc.). Returns entries with action type, executor, target, timestamps, and optional reason. Supports pagination and filtering by user/action type.",
  inputSchema: z.object({
    limit: z.number().min(1).max(100).optional().describe("Max entries (1-100, default 50)"),
    user_id: z.string().optional().describe("Filter to actions by this user"),
    action_type: z
      .number()
      .optional()
      .describe("Action type number (see Discord's AuditLogEvent enum)"),
    before: z.string().optional().describe("Return entries before this entry ID"),
    after: z.string().optional().describe("Return entries after this entry ID"),
  }),
  execute: async ({ limit, user_id, action_type, before, after }) => {
    const params = new URLSearchParams({ limit: String(limit ?? 50) });
    if (user_id) params.set("user_id", user_id);
    if (action_type !== undefined) params.set("action_type", String(action_type));
    if (before) params.set("before", before);
    if (after) params.set("after", after);
    const data = (await discord.get(Routes.guildAuditLog(DISCORD_GUILD_ID), {
      query: params,
    })) as {
      audit_log_entries: Array<{
        id: string;
        action_type: number;
        user_id: string | null;
        target_id: string | null;
        reason: string | null;
        changes?: Array<{ key: string; old_value?: unknown; new_value?: unknown }>;
      }>;
      users?: Array<{ id: string; username: string; global_name: string | null }>;
    };
    const userMap = new Map((data.users ?? []).map((u) => [u.id, u.global_name ?? u.username]));
    return JSON.stringify(
      data.audit_log_entries.map((entry) => ({
        id: entry.id,
        actionType: entry.action_type,
        executor: entry.user_id ? (userMap.get(entry.user_id) ?? entry.user_id) : null,
        targetId: entry.target_id,
        reason: entry.reason,
        changes: entry.changes,
      })),
    );
  },
});
