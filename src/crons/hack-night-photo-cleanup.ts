import { ChannelType, type Client } from "discord.js";
import { schedule } from "node-cron";

import {
	HACK_NIGHT_CHANNEL_ID,
	HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID,
} from "../utils/consts";
import { generateEventSlug, getEventIndex } from "../utils/r2";

const SEND_LEADERBOARD_MESSAGE = true;

export default async function startTask(client: Client) {
	const task = schedule("0 18 * * 7", handler(client));
	return task.start();
}

function handler(client: Client) {
	return async () => {
		const channel = client.channels.cache.get(HACK_NIGHT_CHANNEL_ID);

		if (!channel) {
			console.error("Could not find channel: #hack-night");
			return;
		}

		if (!channel.isSendable()) {
			console.error("Cannot send messages to #hack-night");
			return;
		}

		if (channel.type !== ChannelType.GuildText) {
			console.error("Cannot create threads in #hack-night");
			return;
		}

		const threads = await channel.threads.fetchActive();

		if (!threads) {
			console.error("Could not fetch active threads");
			return;
		}

		const hackNightImageThread = threads.threads
			.filter((t) => {
				return t.name.startsWith("Hack Night Images - ");
			})
			.sorted((a, b) => {
				if (!a.createdTimestamp || !b.createdTimestamp) return 0;
				return b.createdTimestamp - a.createdTimestamp;
			})
			.first();

		if (!hackNightImageThread) {
			console.error("Could not find latest thread");
			return;
		}

		// Get event data from R2 instead of Discord attachments
		const eventSlug = generateEventSlug(hackNightImageThread.createdAt!);
		const eventIndex = await getEventIndex(eventSlug);

		if (!eventIndex || eventIndex.images.length === 0) {
			console.error("No images found in R2 for this event");
			return;
		}

		const contributors = new Map<string, number>();

		for (const image of eventIndex.images) {
			const author = image.discordUserId;
			const count = contributors.get(author) ?? 0;
			contributors.set(author, count + 1);
		}

		const starterMessage = await hackNightImageThread.fetchStarterMessage();

		if (!starterMessage) {
			console.error("Could not fetch starter message");
			return;
		}

		if (SEND_LEADERBOARD_MESSAGE) {
			await starterMessage.reply({
				content: `Thanks for coming to Hack Night! We took ${eventIndex.images.length} picture${eventIndex.images.length === 1 ? "" : "s"} :D`,
			});

			const topContributors = Array.from(contributors)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5);

			await channel.send({
				content: `Our top contributors this week are:\n${topContributors
					.map(([id, count], index) => `\n#${index + 1}: <@${id}> - ${count}`)
					.join("")}`,
			});
		}

		// Images are now uploaded to R2 in real-time via the hack-night-images handler

		await starterMessage.unpin();
		await hackNightImageThread.setLocked(true);
		await hackNightImageThread.setArchived(true);

		const roleHolder = await channel.guild.roles
			.fetch(HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID)
			.then((r) => {
				return r?.members;
			});

		if (roleHolder) {
			for (const member of roleHolder.values()) {
				await member.roles.remove(HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID);
			}
		}

		const [winner] = Array.from(contributors).sort((a, b) => b[1] - a[1]);

		if (winner) {
			await channel.guild.members.fetch(winner[0]).then((m) => {
				m.roles.add(HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID);
			});
		}

		await channel.send({
			content: `Congratulations to <@${winner[0]}> for winning the Hack Night Photography Award! :D`,
		});
		await channel.send({
			content: "Happy hacking, and see you next time! :D",
		});

		console.log("Cleaned up Hack Night images thread");
	};
}
