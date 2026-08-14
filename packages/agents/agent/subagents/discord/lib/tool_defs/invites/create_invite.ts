import {
  Routes,
  type RESTPostAPIChannelInviteJSONBody,
  type RESTPostAPIChannelInviteResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import { channelId, reason, responseString } from "../../constants.ts";
import { guildChannel } from "../../projections.ts";

export const create_invite = defineTool({
  access: { risk: "destructive", minRole: "admin" },
  description:
    "Create a new server invite for a specific channel. Returns the invite code and URL.",
  input: z.strictObject({
    channel_id: channelId,
    max_age: z.int().min(0).max(604_800).optional(),
    max_uses: z.int().min(0).max(100).optional(),
    temporary: z.boolean().optional(),
    unique: z.boolean().optional(),
    reason: reason.optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    const invite = discordObject<RESTPostAPIChannelInviteResult>(
      await rest.post(Routes.channelInvites(input.channel_id), {
        body: compact<RESTPostAPIChannelInviteJSONBody>({
          max_age: input.max_age,
          max_uses: input.max_uses,
          temporary: input.temporary,
          unique: input.unique,
        }),
        reason: input.reason,
      }),
      "create channel invite",
    );
    const code = responseString.safeParse(invite.code).data;
    return {
      code: invite.code,
      url: code === undefined ? null : `https://discord.gg/${code}`, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
      channelId: invite.channel?.id ?? input.channel_id,
      maxAge: invite.max_age,
      maxUses: invite.max_uses,
      temporary: invite.temporary,
      expiresAt: invite.expires_at ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    };
  },
});
