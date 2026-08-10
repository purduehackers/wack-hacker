import type { REST } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { UpstreamError } from "@repo/shared/errors";
import { Routes, type RESTGetAPIInviteResult } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { reason } from "../../constants.ts";

/** An invite code is globally addressable, so scope must be proved before revoking. */
async function requireGuildInvite(rest: REST, code: string): Promise<void> {
  const invite = discordObject<RESTGetAPIInviteResult>(
    await rest.get(Routes.invite(code)),
    "get invite",
  );
  if (invite.guild?.id !== DISCORD_GUILD_ID) {
    throw new UpstreamError({
      service: "Discord",
      status: 403,
      detail: "invite is outside the managed guild",
    });
  }
}

export const delete_invite = defineTool({
  access: { risk: "destructive", minRole: "admin" },
  description:
    "Revoke an active invite by its code. Use list_invites first to find available codes.",
  input: z.strictObject({
    code: z
      .stringFormat("discord-invite-code", /^[A-Za-z0-9_-]+$/u)
      .min(2)
      .max(100),
    reason: reason.optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    await requireGuildInvite(rest, input.code);
    await rest.delete(Routes.invite(input.code), { reason: input.reason });
    return { success: true, deleted: input.code };
  },
});
