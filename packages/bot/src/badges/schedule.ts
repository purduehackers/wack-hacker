import { createHash } from "node:crypto";

import { BADGES_CHANNEL_ID } from "@repo/badges/contracts";
import { workResponse } from "@repo/badges/wire";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { AttachmentBuilder, DiscordAPIError } from "discord.js";
import type { Client } from "discord.js";

import type { Schedule } from "../framework/schedules.ts";
import { cardEmbeds, controls } from "./card.ts";
import type { BadgeClient } from "./client.ts";
import { deliveredResult, settledCard } from "./status.ts";

export function badgeWork(api: BadgeClient, secret: string): Schedule {
  return {
    name: "badge-review-work",
    cron: "* * * * *",
    run: async ({ client }) =>
      Result.tryPromise({
        try: async () => {
          for (let i = 0; i < 8; i += 1) {
            const { card, worked } = workResponse.parse(await api.post("work", {}, 90_000));
            if (!card) {
              if (worked) continue;
              return;
            }
            const channel = await client.channels.fetch(card.review.threadId);
            if (
              !channel?.isThread() ||
              channel.parentId !== BADGES_CHANNEL_ID ||
              channel.guildId !== DISCORD_GUILD_ID
            )
              throw new Error("Badge review thread is unavailable.");
            const components = controls(card, secret);
            const attachments = card.files.map(
              (file) =>
                new AttachmentBuilder(Buffer.from(file.data, "base64"), { name: file.name }),
            );
            // Each step arrives at the bottom of the thread. Retries reuse its nonce.
            const nonce = createHash("sha256")
              .update(`${card.review.id}:${card.version}`)
              .digest("hex")
              .slice(0, 24);
            const message = await channel.send({
              embeds: cardEmbeds(card),
              components,
              files: attachments,
              nonce,
              enforceNonce: true,
              allowedMentions: { parse: [] },
            });
            const previousId = card.review.cardId;
            if (previousId && previousId !== message.id) {
              try {
                const previous = await channel.messages.fetch({ message: previousId, force: true });
                if (previous.author.id === client.user?.id)
                  await previous.edit(
                    settledCard(previous, deliveredResult(previous, card.review), message.url),
                  );
              } catch (cause) {
                // Deleting an old card must not block delivery; other failures retry before ack.
                if (!(cause instanceof DiscordAPIError) || cause.code !== 10_008) throw cause;
              }
            }
            await api.post("ack", {
              id: card.jobId,
              lease: card.lease,
              reviewId: card.review.id,
              version: card.version,
              messageId: message.id,
            });
          }
        },
        catch: (cause) => new Transient({ operation: "badge workflow", detail: messageOf(cause) }),
      }),
  };
}

/** Typing is transient; durable delivery settles the previous card and sends the next step. */
export async function runBadgeWork(
  api: BadgeClient,
  secret: string,
  client: Client,
  threadId?: string,
) {
  const channel = threadId
    ? await client.channels.fetch(threadId).catch(() => undefined)
    : undefined;
  await withBadgeTyping(channel?.isThread() ? channel : undefined, async () => {
    if (!client.isReady()) return;
    const result = await badgeWork(api, secret).run({ client });
    if (Result.isError(result)) console.error("Badge delivery will retry:", result.error);
  });
}

export async function withBadgeTyping<T>(
  channel: { sendTyping(): Promise<void> } | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const typing = () => channel?.sendTyping().catch(() => undefined);
  await typing();
  const timer = setInterval(() => {
    void typing();
  }, 8000);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}
