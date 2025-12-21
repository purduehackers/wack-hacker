import type { MessageReaction, PartialMessageReaction, User, PartialUser, ThreadChannel } from "discord.js";
import { env } from "../../env";
import { detectCommit } from "../../utils/commit-detection";
import {
	BISHOP_ROLE_ID,
	COMMIT_APPROVE_EMOJI,
	COMMIT_EDIT_DESCRIPTION_EMOJI,
	COMMIT_OVERFLOW_FORUM_ID,
	COMMIT_PIN_EMOJI,
	ORGANIZER_ROLE_ID,
} from "../../utils/consts";
import { createApprovedCommit, createUser, getCommit, getUser } from "../../utils/d1";

function isInCommitOverflowForum(reaction: MessageReaction | PartialMessageReaction): boolean {
	const channel = reaction.message.channel;

	if (!channel.isThread()) return false;

	return channel.parentId === COMMIT_OVERFLOW_FORUM_ID;
}

function getCommitDay(): string {
	const now = new Date();
	return now.toLocaleDateString("en-CA", { timeZone: "America/Indiana/Indianapolis" });
}

export async function handlePinReaction(
	reaction: MessageReaction | PartialMessageReaction,
	user: User | PartialUser,
): Promise<void> {
	if (user.bot) return;
	if (reaction.emoji.name !== COMMIT_PIN_EMOJI) return;
	if (!isInCommitOverflowForum(reaction)) return;

	try {
		if (reaction.partial) {
			await reaction.fetch();
		}

		const message = reaction.message;
		if (message.partial) {
			await message.fetch();
		}

		if (!message.pinnable) return;

		await message.pin();
		await message.react("✅");
	} catch (error) {
		console.error("Error pinning message:", error);
	}
}

export async function handleApproveReaction(
	reaction: MessageReaction | PartialMessageReaction,
	user: User | PartialUser,
): Promise<void> {
	if (user.bot) return;
	if (reaction.emoji.name !== COMMIT_APPROVE_EMOJI) return;
	if (!isInCommitOverflowForum(reaction)) return;

	try {
		if (reaction.partial) {
			await reaction.fetch();
		}

		const message = reaction.message;
		if (message.partial) {
			await message.fetch();
		}

		const guild = message.guild;
		if (!guild) return;

		const member = await guild.members.fetch(user.id);
		const isOrganizer = member.roles.cache.has(ORGANIZER_ROLE_ID);
		const isBishop = member.roles.cache.has(BISHOP_ROLE_ID);

		if (!isOrganizer && !isBishop) return;

		const existingCommit = await getCommit(message.id);
		if (existingCommit) return;

		const detectedCommit = detectCommit(message);
		if (!detectedCommit) {
			await message.react("❓");
			return;
		}

		const author = message.author;
		if (!author) return;

		const dbUser = await getUser(author.id);
		if (!dbUser) {
			await createUser(author.id, author.username, "");
		}

		await createApprovedCommit(
			author.id,
			message.id,
			detectedCommit.type,
			getCommitDay(),
			user.id,
		);

		await message.react("✅");
	} catch (error) {
		console.error("Error approving commit:", error);
	}
}

export async function handleEditDescriptionReaction(
	reaction: MessageReaction | PartialMessageReaction,
	user: User | PartialUser,
): Promise<void> {
	if (user.bot) return;
	if (reaction.emoji.name !== COMMIT_EDIT_DESCRIPTION_EMOJI) return;
	if (!isInCommitOverflowForum(reaction)) return;

	try {
		if (reaction.partial) {
			await reaction.fetch();
		}

		const message = reaction.message;
		if (message.partial) {
			await message.fetch();
		}

		if (message.author?.id !== user.id) return;

		const thread = message.channel as ThreadChannel;
		
		const dbUser = await getUser(user.id);
		if (!dbUser || dbUser.thread_id !== thread.id) return;

		const starterMessage = await thread.fetchStarterMessage();
		if (!starterMessage) return;

		const newDescription = message.content?.trim();
		if (!newDescription) return;

		await starterMessage.edit({
			content: newDescription,
		});

		await message.react("✅");
	} catch (error) {
		console.error("Error updating thread description:", error);
	}
}

export default async function handler(
	reaction: MessageReaction | PartialMessageReaction,
	user: User | PartialUser,
): Promise<void> {
	if (env.COMMIT_OVERFLOW_ENABLED !== "1") return;

	await Promise.allSettled([
		handlePinReaction(reaction, user),
		handleApproveReaction(reaction, user),
		handleEditDescriptionReaction(reaction, user),
	]);
}
