import { z } from "zod";

import { defineTask } from "../define.ts";

export const sendMessage = defineTask({
  name: "send-message",
  schema: z.object({
    channelId: z.string(),
    content: z.string(),
  }),
  async handle(payload, discord) {
    await discord.channels.createMessage(payload.channelId, { content: payload.content });
  },
});
