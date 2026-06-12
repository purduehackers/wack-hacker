import { Events } from "discord.js";
import { z } from "zod";

import { definePacketEvent } from "./define.ts";

const ReactionData = z.object({
  messageId: z.string(),
  channelId: z.string(),
  guildId: z.string(),
  emoji: z.object({
    id: z.string().nullable(),
    name: z.string(),
  }),
  creator: z.object({
    id: z.string(),
    username: z.string(),
    nickname: z.string().optional(),
    bot: z.boolean().optional(),
  }),
});

// Add and remove share the wire shape and serialization; they differ only in
// discriminator and direction, so both live in this module.

export const reactionAddEvent = definePacketEvent({
  type: "GATEWAY_MESSAGE_REACTION_ADD",
  kind: "reactionAdd",
  data: ReactionData,
  dedupKey: (packet) =>
    `react:${packet.data.messageId}:${packet.data.creator.id}:${packet.data.emoji.id ?? packet.data.emoji.name}`,
  bind: (client, publish) => {
    client.on(Events.MessageReactionAdd, async (reaction, user) => {
      if (user.bot) return;
      const message = await reaction.message.fetch();

      await publish({
        type: "GATEWAY_MESSAGE_REACTION_ADD",
        timestamp: new Date(),
        data: {
          messageId: message.id,
          channelId: message.channelId,
          guildId: message.guildId!,
          emoji: { id: reaction.emoji.id, name: reaction.emoji.name ?? "" },
          creator: { id: user.id, username: user.username ?? "unknown" },
        },
      });
    });
  },
});

export const reactionRemoveEvent = definePacketEvent({
  type: "GATEWAY_MESSAGE_REACTION_REMOVE",
  kind: "reactionRemove",
  data: ReactionData,
  dedupKey: (packet) =>
    `unreact:${packet.data.messageId}:${packet.data.creator.id}:${packet.data.emoji.id ?? packet.data.emoji.name}`,
  bind: (client, publish) => {
    client.on(Events.MessageReactionRemove, async (reaction, user) => {
      if (user.bot) return;
      const message = await reaction.message.fetch();

      await publish({
        type: "GATEWAY_MESSAGE_REACTION_REMOVE",
        timestamp: new Date(),
        data: {
          messageId: message.id,
          channelId: message.channelId,
          guildId: message.guildId!,
          emoji: { id: reaction.emoji.id, name: reaction.emoji.name ?? "" },
          creator: { id: user.id, username: user.username ?? "unknown" },
        },
      });
    });
  },
});
