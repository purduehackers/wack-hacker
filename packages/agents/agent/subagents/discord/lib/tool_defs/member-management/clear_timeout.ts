import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTPatchAPIGuildMemberJSONBody } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { memberId, reason } from "../../constants.ts";

export const clear_timeout = defineTool({
  access: { risk: "destructive", minRole: "admin" },
  description: "Clear an active timeout on a member, restoring their ability to talk immediately.",
  input: z.strictObject({ member_id: memberId, reason: reason.optional() }),
  execute: async (input) => {
    const rest = discordRest();
    await rest.patch(Routes.guildMember(DISCORD_GUILD_ID, input.member_id), {
      body: {
        // oxlint-disable-next-line unicorn/no-null -- Discord clears a timeout only when the field is explicitly null.
        communication_disabled_until: null,
      } satisfies RESTPatchAPIGuildMemberJSONBody,
      reason: input.reason,
    });
    return { timeout_cleared: true, member_id: input.member_id };
  },
});
