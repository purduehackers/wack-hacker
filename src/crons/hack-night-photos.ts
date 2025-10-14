import { type Client, ThreadAutoArchiveDuration } from "discord.js";
import { schedule } from "node-cron";

import { HACK_NIGHT_CHANNEL_ID } from "../utils/consts";

// TODO(@rayhanadev): add more fun messages
const HACK_NIGHT_MESSAGES = [
	"Happy Hack Night! :D",
	"Welcome to Hack Night! :D",
	"Hack Night is here! :D",
	"It's Hack Night! :D",
	"Hack Night is starting! :D",
	"Let's get hacking! :D",
	"Time to hack! :D",
	"Hack Night is live! :D",
	"Hack Night is a go! :D",
];

export default async function startTask(client: Client) {
	const task = schedule("0 20 * * 5", handler(client));
	return task.start();
}

function handler(client: Client) {
	return async () => {
		const channel = client.channels.cache.get(HACK_NIGHT_CHANNEL_ID);
		const startContent = 
			`${HACK_NIGHT_MESSAGES[Math.floor(Math.random() * HACK_NIGHT_MESSAGES.length)]} 🎉`
			+ `\n\nShare your pictures from the night in this thread!`;
		const pingContent = `(<@&1348025087894355979>)`;

		if (!channel) {
			console.error("Could not find channel: #hack-night");
			return;
		}

		if (!channel.isSendable()) {
			console.error("Cannot send messages to #hack-night");
			return;
		}

		const message = await channel.send({
			content: startContent
		});

		if (!message) {
			console.error("Could not create Hack Night images thread");
			return;
		}

		await message.pin();

		const dateObj = new Date();
		const date = `${(`${1 + dateObj.getMonth()}`).padStart(2, "0")}/${(`${dateObj.getDate()}`).padStart(2, "0")}`;

		const thread = await message.startThread({
			name: `Hack Night Images - ${date}`,
			autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
		});

		const pinnedMessage = await channel.messages.fetch({ limit: 1 });

		if (!pinnedMessage) {
			console.error("Could not fetch last message");
			return;
		}

		const systemMessage = pinnedMessage.first();

		if (!systemMessage) {
			console.error("Could not find last message");
			return;
		}

		await systemMessage.delete();

		const message2 = await thread.send({
			content: pingContent
		});

		if (!message2) {
			console.error("Could not send ping message");
			return;
		}

		console.log("Created Hack Night images thread");
	};
}
