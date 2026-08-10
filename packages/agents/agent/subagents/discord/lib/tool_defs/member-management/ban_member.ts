import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTPutAPIGuildBanJSONBody } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { memberId, reason } from "../../constants.ts";

export const ban_member = defineTool({
  access: { risk: "destructive", minRole: "admin", confirm: "second-party" },
  description:
    "Ban a member from the Discord server. They cannot rejoin until unbanned. Optionally delete the last N seconds of their messages (0-604800, 0 by default).",
  input: z.strictObject({
    member_id: memberId,
    delete_message_seconds: z.int().min(0).max(604_800).optional(),
    reason: reason.optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    await rest.put(Routes.guildBan(DISCORD_GUILD_ID, input.member_id), {
      body: {
        delete_message_seconds: input.delete_message_seconds ?? 0,
      } satisfies RESTPutAPIGuildBanJSONBody,
      reason: input.reason,
    });
    return { banned: true, member_id: input.member_id };
  },
});
