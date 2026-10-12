import { createHash } from "node:crypto";

import { BADGES_CHANNEL_ID } from "@repo/badges/contracts";
import { workResponse } from "@repo/badges/wire";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { AttachmentBuilder } from "discord.js";

import type { Schedule } from "../framework/schedules.ts";
import { cardEmbeds, controls } from "./card.ts";
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
          const components = controls(card, secret);
          const attachments = card.files.map(
            (file) => new AttachmentBuilder(Buffer.from(file.data, "base64"), { name: file.name }),
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
          await api.post("ack", {
            id: card.jobId,
            lease: card.lease,
            reviewId: card.review.id,
            version: card.version,
            messageId: message.id,
          });
        },
        catch: (cause) => new Transient({ operation: "badge workflow", detail: messageOf(cause) }),
      }),
  };
}
