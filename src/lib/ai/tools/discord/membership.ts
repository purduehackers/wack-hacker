import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { DISCORD_GUILD_ID } from "../../../protocol/constants.ts";
import { approval } from "../../approvals/index.ts";
import { admin } from "../../skills/index.ts";
import { discord } from "./client.ts";

export const add_member_to_platform = admin(
  approval(
    tool({
      description:
        "Invite a new member to the Discord server by creating a one-time-use invite link. Bot tokens cannot add users directly (that requires OAuth2 with guilds.join scope), so this returns an invite URL that the new member opens to join. Defaults to a single-use invite that expires in 24h.",
      inputSchema: z.object({
        channel_id: z
          .string()
          .describe("Channel ID the invite routes through (any text channel works)"),
        max_age_seconds: z
          .number()
          .min(0)
          .optional()
          .describe("Seconds until expiry (0 for never, default 86400 = 24h)"),
        max_uses: z
          .number()
          .min(0)
          .optional()
          .describe("Max number of uses (0 for unlimited, default 1)"),
        reason: z.string().optional().describe("Audit log reason"),
      }),
      execute: async ({ channel_id, max_age_seconds, max_uses, reason }) => {
        const invite = (await discord.post(Routes.channelInvites(channel_id), {
          body: {
            max_age: max_age_seconds ?? 86_400,
            max_uses: max_uses ?? 1,
            temporary: false,
            unique: true,
          },
          reason: reason ?? undefined,
        })) as { code: string; max_age: number; max_uses: number; expires_at: string | null };
        return JSON.stringify({
          code: invite.code,
          url: `https://discord.gg/${invite.code}`,
          maxAge: invite.max_age,
          maxUses: invite.max_uses,
          expiresAt: invite.expires_at ?? null,
        });
      },
    }),
  ),
);

export const remove_member_from_platform = admin(
  approval(
    tool({
      description:
        "Remove (kick) a member from the Discord server. The user can rejoin with a new invite. Resolve the member ID first via search_members — never kick on ambiguous input. To permanently block them, ban them via ban_member instead.",
      inputSchema: z.object({
        member_id: z.string().describe("Discord user ID of the member to remove"),
        reason: z.string().optional().describe("Audit log reason"),
      }),
      execute: async ({ member_id, reason }) => {
        await discord.delete(Routes.guildMember(DISCORD_GUILD_ID, member_id), {
          reason: reason ?? undefined,
        });
        return JSON.stringify({ removed: true, member_id });
      },
    }),
  ),
);
