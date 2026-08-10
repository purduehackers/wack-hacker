/* oxlint-disable unicorn/no-null -- Discord's JSON API uses null for explicit absence/field clearing. */

import { makeURLSearchParams } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  Routes,
  type RESTGetAPIAuditLogQuery,
  type RESTGetAPIAuditLogResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordArray, discordObject, discordRest } from "../../client.ts";
import { discordSnowflakeSchema, responseString } from "../../constants.ts";

export const get_audit_log = defineTool({
  access: { risk: "read" },
  description:
    "Get the Discord server's audit log. Use to find who performed admin actions (role changes, bans, channel edits, etc.). Returns entries with action type, executor, target, timestamps, and optional reason. Supports pagination and filtering by user/action type.",
  input: z.strictObject({
    limit: z.int().min(1).max(100).optional(),
    user_id: discordSnowflakeSchema.optional(),
    action_type: z.int().min(1).max(255).optional(),
    before: discordSnowflakeSchema.optional(),
    after: discordSnowflakeSchema.optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    const raw = discordObject<RESTGetAPIAuditLogResult>(
      await rest.get(Routes.guildAuditLog(DISCORD_GUILD_ID), {
        query: makeURLSearchParams<RESTGetAPIAuditLogQuery>({
          limit: input.limit ?? 50,
          ...(input.user_id === undefined ? {} : { user_id: input.user_id }),
          ...(input.action_type === undefined ? {} : { action_type: input.action_type }),
          ...(input.before === undefined ? {} : { before: input.before }),
          ...(input.after === undefined ? {} : { after: input.after }),
        }),
      }),
      "get audit log",
    );
    const userNames = new Map(
      discordArray<RESTGetAPIAuditLogResult["users"]>(raw.users, "get audit log users").map(
        (user) => [user.id, user.global_name ?? user.username],
      ),
    );
    return discordArray<RESTGetAPIAuditLogResult["audit_log_entries"]>(
      raw.audit_log_entries,
      "get audit log entries",
    ).map((entry) => {
      const executorId = responseString.safeParse(entry.user_id).data;
      return {
        id: entry.id,
        actionType: entry.action_type,
        executor: executorId === undefined ? null : (userNames.get(executorId) ?? executorId),
        targetId: entry.target_id ?? null,
        reason: entry.reason ?? null,
        changes: entry.changes,
      };
    });
  },
});
