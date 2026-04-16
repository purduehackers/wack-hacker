import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { env } from "../../../../env.ts";
import { admin } from "../../skills/index.ts";
import { discord } from "./client.ts";

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const list_invites = admin(
  tool({
    description:
      "List all active server invites with their codes, channels, creators, usage counts, and expiry dates.",
    inputSchema: z.object({}),
    execute: async () => {
      const invites = (await discord.get(Routes.guildInvites(env.DISCORD_GUILD_ID))) as any[];
      return JSON.stringify(
        invites.map((inv) => ({
          code: inv.code,
          channel: inv.channel ? { id: inv.channel.id, name: inv.channel.name } : null,
          inviter: inv.inviter ? { id: inv.inviter.id, username: inv.inviter.username } : null,
          uses: inv.uses,
          maxUses: inv.max_uses,
          maxAge: inv.max_age,
          temporary: inv.temporary,
          expiresAt: inv.expires_at ?? null,
        })),
      );
    },
  }),
);

export const create_invite = admin(
  tool({
    description:
      "Create a new server invite for a specific channel. Returns the invite code and URL.",
    inputSchema: z.object({
      channel_id: z.string().describe("Channel ID to create the invite for"),
      max_age: z
        .number()
        .min(0)
        .optional()
        .describe("Duration in seconds before expiry, 0 for never (default 86400 = 24h)"),
      max_uses: z
        .number()
        .min(0)
        .optional()
        .describe("Max number of uses, 0 for unlimited (default 0)"),
      temporary: z
        .boolean()
        .optional()
        .describe("Whether this invite grants temporary membership (default false)"),
      unique: z
        .boolean()
        .optional()
        .describe(
          "If true, create a fresh invite instead of reusing a similar one (default false)",
        ),
      reason: z.string().optional().describe("Audit log reason"),
    }),
    execute: async ({ channel_id, max_age, max_uses, temporary, unique, reason }) => {
      const invite = (await discord.post(Routes.channelInvites(channel_id), {
        body: { max_age, max_uses, temporary, unique },
        reason: reason ?? undefined,
      })) as any;
      return JSON.stringify({
        code: invite.code,
        url: `https://discord.gg/${invite.code}`,
        channelId: invite.channel?.id ?? channel_id,
        maxAge: invite.max_age,
        maxUses: invite.max_uses,
        temporary: invite.temporary,
        expiresAt: invite.expires_at ?? null,
      });
    },
  }),
);

export const delete_invite = admin(
  tool({
    description:
      "Revoke an active invite by its code. Use list_invites first to find available codes.",
    inputSchema: z.object({
      code: z.string().describe("Invite code to delete (e.g. 'abc123' from discord.gg/abc123)"),
      reason: z.string().optional().describe("Audit log reason"),
    }),
    execute: async ({ code, reason }) => {
      await discord.delete(Routes.invite(code), {
        reason: reason ?? undefined,
      });
      return JSON.stringify({ success: true, deleted: code });
    },
  }),
);
