import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTPatchAPIGuildMemberJSONBody } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { memberId, reason } from "../../constants.ts";

export const timeout_member = defineTool({
  access: { risk: "destructive", minRole: "admin" },
  description:
    "Timeout a member. They cannot send messages, react, speak, or join voice until the timeout expires. Max duration is 28 days.",
  input: z.strictObject({
    member_id: memberId,
    duration_seconds: z.int().min(1).max(2_419_200),
    reason: reason.optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    const timeoutUntil = new Date(Date.now() + input.duration_seconds * 1_000).toISOString();
    await rest.patch(Routes.guildMember(DISCORD_GUILD_ID, input.member_id), {
      body: {
        communication_disabled_until: timeoutUntil,
      } satisfies RESTPatchAPIGuildMemberJSONBody,
      reason: input.reason,
    });
    return { timeout_until: timeoutUntil, member_id: input.member_id };
  },
});
