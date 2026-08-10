/* oxlint-disable unicorn/no-null -- Discord's JSON API uses null for explicit absence/field clearing. */

import {
  Routes,
  type RESTPostAPIChannelInviteJSONBody,
  type RESTPostAPIChannelInviteResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { channelId, guildChannel, reason, responseString } from "../../constants.ts";

export const add_member_to_platform = defineTool({
  access: { risk: "destructive", minRole: "admin" },
  description:
    "Invite a new member to the Discord server by creating a one-time-use invite link. Bot tokens cannot add users directly (that requires OAuth2 with guilds.join scope), so this returns an invite URL that the new member opens to join. Defaults to a single-use invite that expires in 24h.",
  input: z.strictObject({
    channel_id: channelId,
    max_age_seconds: z.int().min(0).max(604_800).optional(),
    max_uses: z.int().min(0).max(100).optional(),
    reason: reason.optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    const invite = discordObject<RESTPostAPIChannelInviteResult>(
      await rest.post(Routes.channelInvites(input.channel_id), {
        body: {
          max_age: input.max_age_seconds ?? 86_400,
          max_uses: input.max_uses ?? 1,
          temporary: false,
          unique: true,
        } satisfies RESTPostAPIChannelInviteJSONBody,
        reason: input.reason,
      }),
      "add member invite",
    );
    const code = responseString.safeParse(invite.code).data;
    return {
      code: invite.code,
      url: code === undefined ? null : `https://discord.gg/${code}`,
      maxAge: invite.max_age,
      maxUses: invite.max_uses,
      expiresAt: invite.expires_at ?? null,
    };
  },
});
