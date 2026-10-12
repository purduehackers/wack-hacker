import { createHash } from "node:crypto";

import { BADGES_CHANNEL_ID } from "@repo/badges/contracts";
import { workResponse } from "@repo/badges/wire";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { AttachmentBuilder } from "discord.js";

import type { Schedule } from "../framework/schedules.ts";
import { cardText, controls } from "./card.ts";
import type { BadgeClient } from "./client.ts";

export function badgeWork(api: BadgeClient, secret: string): Schedule {
  return {
    name: "badge-review-work",
    cron: "* * * * *",
    run: async ({ client }) =>
      Result.tryPromise({
        try: async () => {
          const { card } = workResponse.parse(await api.post("work", {}, 90_000));
          if (!card) return;
          const channel = await client.channels.fetch(card.review.threadId);
          if (
            !channel?.isThread() ||
            channel.parentId !== BADGES_CHANNEL_ID ||
            channel.guildId !== DISCORD_GUILD_ID
          )
            throw new Error("Badge review thread is unavailable.");
          const content = cardText(card.review),
            components = controls(card, secret);
          const attachments = card.files.map(
            (file) => new AttachmentBuilder(Buffer.from(file.data, "base64"), { name: file.name }),
          );
          const previous = card.review.cardId
            ? await channel.messages.fetch(card.review.cardId).catch(() => undefined)
            : undefined;
          // A stable nonce covers a lost create response without conflating revisions.
          const nonce = createHash("sha256").update(card.review.id).digest("hex").slice(0, 24);
          const message = previous
            ? await previous.edit({
                content,
                components,
                files: attachments,
                attachments: [],
                allowedMentions: { parse: [] },
              })
            : await channel.send({
                content,
                components,
                files: attachments,
                nonce,
                enforceNonce: true,
                allowedMentions: { parse: [] },
              });
          await api.post("ack", {
            id: card.jobId,
            lease: card.lease,
            reviewId: card.review.id,
            messageId: message.id,
          });
        },
        catch: (cause) => new Transient({ operation: "badge workflow", detail: messageOf(cause) }),
      }),
  };
}
