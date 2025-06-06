import { type Message } from "discord.js";
import { connectToApi, sendDashboardMessage } from "../../utils/phack";

const client = await connectToApi();

export default async function handler(message: Message) {
  if (message.author.bot) return;
  if (message.channel.isDMBased()) return;

  await sendDashboardMessage(client, {
    image: message.author.avatarURL(),
    timestamp: message.createdAt.toISOString(),
    username: message.author.username,
    content: message.content,
    attachments:
      message.attachments.size > 0
        ? [...message.attachments.entries().map(([, { url }]) => url)]
        : undefined,
  });
}
