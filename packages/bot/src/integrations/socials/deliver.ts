import { createHash } from "node:crypto";

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { RecoveryRequired, retryAfterMs, UpstreamError } from "@repo/shared/errors";
import { Routes } from "discord-api-types/v10";
import { PermissionFlagsBits } from "discord.js";
import type { Client } from "discord.js";
import { z } from "zod";

import { enrichSocialPost, socialEmbed } from "./embeds.ts";
import { requireSocialState } from "./poll.ts";
import type { SocialLease } from "./store.ts";
import type { SocialPost, SocialSource } from "./types.ts";

export interface SocialDelivery {
  readonly send: (source: SocialSource, post: SocialPost) => Promise<void>;
  readonly find: (post: SocialPost, attemptedAt: number) => Promise<boolean>;
}

const messageSchema = z.object({
  id: z.string(),
  author: z.object({ id: z.string() }),
  timestamp: z.string(),
  embeds: z.array(z.object({ url: z.string().optional() })),
});

/** Discord can return empty history without Read Message History, not an error. */
export async function verifySocialsAccess(client: Client<true>, channelId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId, { force: true });
  if (!channel?.isTextBased() || channel.isDMBased() || channel.guildId !== DISCORD_GUILD_ID) {
    throw new UpstreamError({
      service: "discord socials",
      status: 403,
      detail: "expected the configured guild text channel",
    });
  }
  await channel.guild.roles.fetch();
  const member = await channel.guild.members.fetchMe({ force: true });
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory,
  ];
  if (!channel.permissionsFor(member).has(required)) {
    throw new UpstreamError({
      service: "discord socials",
      status: 403,
      detail: "requires View Channel, Send Messages, Embed Links, and Read Message History",
    });
  }
}

export function createSocialDelivery(
  client: {
    readonly rest: Pick<Client<true>["rest"], "get" | "post">;
    readonly user: Pick<Client<true>["user"], "id">;
  },
  channelId: string,
  beforeRequest: () => Promise<void>,
): SocialDelivery {
  return {
    send: async (source, post) => {
      const enriched = await enrichSocialPost(source, post);
      await beforeRequest();
      const nonce = createHash("sha256")
        .update(`${channelId}:${source.id}:${source.account}:${post.id}`)
        .digest("hex")
        .slice(0, 25);
      await client.rest.post(Routes.channelMessages(channelId), {
        body: {
          embeds: [socialEmbed(source, enriched)],
          allowed_mentions: { parse: [] },
          nonce,
          enforce_nonce: true,
        },
        signal: AbortSignal.timeout(20_000),
      });
    },
    find: async (post, attemptedAt) => {
      let before: string | undefined;
      // Walk back to the attempt, never infer absence from a truncated page.
      for (let page = 0; page < 50; page++) {
        await beforeRequest();
        const query = new URLSearchParams({ limit: "100" });
        if (before !== undefined) query.set("before", before);
        const raw = await client.rest.get(Routes.channelMessages(channelId), {
          query,
          signal: AbortSignal.timeout(20_000),
        });
        const messages = z.array(messageSchema).parse(raw);
        const found = messages.some(
          (entry) =>
            entry.author.id === client.user.id &&
            entry.embeds.some((embed) => embed.url === post.url),
        );
        if (found) return true;
        const last = messages.at(-1);
        if (last === undefined || Date.parse(last.timestamp) < attemptedAt - 60_000) return false;
        before = last.id;
      }
      throw new RecoveryRequired({
        operation: "socials send reconciliation",
        detail: "message history limit reached",
        remediation: "reconcile the pending post before resending it",
      });
    },
  };
}

/** Persist intent before POST; a lost response/save is reconciled through Discord. */
export async function deliverSocialPosts(
  source: SocialSource,
  lease: SocialLease,
  delivery: SocialDelivery,
  now = Date.now(),
): Promise<void> {
  const state = await requireSocialState(source, lease);
  for (const pending of state.pending.filter((item) => item.retryAt <= now).slice(0, 10)) {
    const previousAttempt = pending.attemptedAt;
    pending.attempts++;
    pending.attemptedAt ??= now;
    pending.retryAt =
      now + Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.min(pending.attempts - 1, 9));
    await lease.save(state);
    try {
      const found =
        previousAttempt !== undefined && (await delivery.find(pending.post, previousAttempt));
      if (!found) await delivery.send(source, pending.post);
      state.pending = state.pending.filter((item) => item.post.id !== pending.post.id);
      await lease.save(state);
    } catch (cause) {
      const retry = retryAfterMs(cause);
      if (retry !== undefined) {
        pending.retryAt = Math.max(pending.retryAt, Date.now() + retry);
        await lease.save(state);
      }
      throw cause;
    }
  }
}
