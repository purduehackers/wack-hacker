import { Events } from "discord.js";
import { z } from "zod";

import { definePacketEvent } from "./define.ts";

const MessageDeleteData = z.object({
  id: z.string(),
  channelId: z.string(),
  guildId: z.string(),
});

export const messageDeleteEvent = definePacketEvent({
  type: "GATEWAY_MESSAGE_DELETE",
  kind: "messageDelete",
  data: MessageDeleteData,
  dedupKey: (packet) => `del:${packet.data.id}`,
  bind: (client, publish) => {
    client.on(Events.MessageDelete, async (message) => {
      if (!message.guildId) return;

      await publish({
        type: "GATEWAY_MESSAGE_DELETE",
        timestamp: new Date(),
        data: {
          id: message.id,
          channelId: message.channelId,
          guildId: message.guildId,
        },
      });
    });
  },
});
