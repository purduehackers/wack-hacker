import { type Message } from "discord.js";

const CORE_COMMUNITY_CHANNEL = "938671895430180865";
const WELCOMERS_ROLE = "1381409977775947838";

export default async function handler(message: Message) {
  if (message.author.bot) return;
  if (message.channelId !== "1182158612454449282") return;
  if (message.channel.isDMBased()) return;
  if (message.system) return;

  await message.client.channels
    .fetch(CORE_COMMUNITY_CHANNEL)
    .then((channel) => {
      if (!channel || !channel.isSendable()) return;
      channel.send(`Hey <@&${WELCOMERS_ROLE}>, somebody just introduced themselves!! Give them a warm welcome :D

${message.channel.url}`);
    });
}
