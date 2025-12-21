import {
	type ChatInputCommandInteraction,
	ChannelType,
	EmbedBuilder,
	ForumChannel,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import {
	calculateStreaks,
	createUser,
	deleteUser,
	deleteUserCommits,
	getApprovedCommitCount,
	getDistinctCommitDays,
	getUser,
	getUserCommits,
} from "../utils/d1";
import {
	BISHOP_ROLE_ID,
	COMMIT_OVERFLOW_FORUM_ID,
	COMMIT_OVERFLOW_ROLE_ID,
	ORGANIZER_ROLE_ID,
} from "../utils/consts";

export const data = new SlashCommandBuilder()
	.setName("commit-overflow")
	.setDescription("Commit Overflow event commands")
	.addSubcommand((subcommand) =>
		subcommand
			.setName("start")
			.setDescription("Create your Commit Overflow thread")
			.addStringOption((option) =>
				option
					.setName("thread_name")
					.setDescription("Name for your thread (e.g. \"ray's winter break grind\")")
					.setRequired(true),
			),
	)
	.addSubcommand((subcommand) =>
		subcommand
			.setName("view")
			.setDescription("View commit overflow profile")
			.addUserOption((option) =>
				option
					.setName("user")
					.setDescription("User to view (defaults to yourself)")
					.setRequired(false),
			),
	);

export async function command(interaction: ChatInputCommandInteraction) {
	const subcommand = interaction.options.getSubcommand();

	if (subcommand === "start") {
		await handleStart(interaction);
	} else if (subcommand === "view") {
		await handleView(interaction);
	}
}

async function handleStart(interaction: ChatInputCommandInteraction) {
	const threadName = interaction.options.getString("thread_name", true);
	const userId = interaction.user.id;
	const username = interaction.user.username;

	const forum = interaction.client.channels.cache.get(COMMIT_OVERFLOW_FORUM_ID);
	if (!forum || forum.type !== ChannelType.GuildForum) {
		await interaction.reply({
			content: "Could not find the Commit Overflow forum channel.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const forumChannel = forum as ForumChannel;
	const existingUser = await getUser(userId);

	if (existingUser?.thread_id) {
		try {
			const existingThread = await forumChannel.threads.fetch(existingUser.thread_id);
			if (existingThread) {
				await interaction.reply({
					content: `You already have a Commit Overflow thread! <#${existingUser.thread_id}>`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
		} catch {
			console.log(`Thread ${existingUser.thread_id} for user ${userId} no longer exists, cleaning up records`);
			await deleteUserCommits(userId);
			await deleteUser(userId);
		}
	}

	await interaction.deferReply();

	let thread: Awaited<ReturnType<typeof forumChannel.threads.create>> | null = null;

	try {
		thread = await forumChannel.threads.create({
			name: threadName,
			message: {
				content: `*No description set yet. React to your own message with ✏️ to set one!*`,
			},
		});

		const infoMessage = await thread.send({
			content: `🟩 **Welcome to Commit Overflow!**

• Share your progress by posting GitHub commits, code screenshots, or updates
• React with 📌 to pin important messages
• Organizers will react with 🟩 to approve commits toward your streak`,
		});

		await infoMessage.pin();

		await createUser(userId, username, thread.id);

		const member = await interaction.guild?.members.fetch(userId);
		if (member) {
			await member.roles.add(COMMIT_OVERFLOW_ROLE_ID);
		}

		await interaction.editReply({
			content: `Your Commit Overflow thread has been created! <#${thread.id}>`,
		});
	} catch (error) {
		console.error("Error creating commit overflow thread:", error);

		if (thread) {
			try {
				await thread.delete();
			} catch (deleteError) {
				console.error("Failed to cleanup thread after error:", deleteError);
			}
		}

		await interaction.editReply({
			content: "Failed to create your thread. Please try again.",
		});
	}
}

async function handleView(interaction: ChatInputCommandInteraction) {
	const targetUser = interaction.options.getUser("user") ?? interaction.user;
	const isViewingSelf = targetUser.id === interaction.user.id;

	if (!isViewingSelf) {
		const member = interaction.member;
		const memberRoles = member && "cache" in member.roles ? member.roles.cache : null;
		const isOrganizer = memberRoles?.has(ORGANIZER_ROLE_ID) ?? false;
		const isBishop = memberRoles?.has(BISHOP_ROLE_ID) ?? false;

		if (!isOrganizer && !isBishop) {
			await interaction.reply({
				content: "You can only view your own profile. Organizers can view anyone's profile.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
	}

	const forum = interaction.client.channels.cache.get(COMMIT_OVERFLOW_FORUM_ID);
	if (!forum || forum.type !== ChannelType.GuildForum) {
		await interaction.reply({
			content: "Could not find the Commit Overflow forum channel.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const forumChannel = forum as ForumChannel;

	await interaction.deferReply();

	try {
		let dbUser = await getUser(targetUser.id);

		if (dbUser?.thread_id) {
			try {
				await forumChannel.threads.fetch(dbUser.thread_id);
			} catch {
				console.log(`Thread ${dbUser.thread_id} for user ${targetUser.id} no longer exists, cleaning up records`);
				await deleteUserCommits(targetUser.id);
				await deleteUser(targetUser.id);
				dbUser = null;
			}
		}

		if (!dbUser) {
			await interaction.editReply({
				content: isViewingSelf
					? "You haven't started Commit Overflow yet. Use `/commit-overflow start` to begin!"
					: `${targetUser.username} hasn't started Commit Overflow yet.`,
			});
			return;
		}

		const [totalCommits, commitDays] = await Promise.all([
			getApprovedCommitCount(targetUser.id),
			getDistinctCommitDays(targetUser.id),
		]);

		const { currentStreak, longestStreak } = calculateStreaks(commitDays);

		const recentCommits = await getUserCommits(targetUser.id);
		const recentFive = recentCommits.slice(0, 5);

		const streakEmoji = currentStreak >= 3 ? " 🔥" : "";

		const embed = new EmbedBuilder()
			.setColor(0x00ff00)
			.setAuthor({
				name: targetUser.username,
				iconURL: targetUser.displayAvatarURL(),
			})
			.setTitle("Commit Overflow Profile")
			.addFields(
				{ name: "Total Commits", value: String(totalCommits), inline: true },
				{ name: "Commit Days", value: String(commitDays.length), inline: true },
				{ name: "\u200b", value: "\u200b", inline: true },
				{ name: "Current Streak", value: `${currentStreak} day${currentStreak !== 1 ? "s" : ""}${streakEmoji}`, inline: true },
				{ name: "Longest Streak", value: `${longestStreak} day${longestStreak !== 1 ? "s" : ""}`, inline: true },
				{ name: "\u200b", value: "\u200b", inline: true },
			)
			.setFooter({ text: "🟩 Commit Overflow 2025" })
			.setTimestamp();

		// if (recentFive.length > 0 && dbUser.thread_id && interaction.guildId) {
		// 	const recentCommitsText = recentFive
		// 		.map((c) => `• https://discord.com/channels/${interaction.guildId}/${dbUser.thread_id}/${c.message_id}`)
		// 		.join("\n");
		// 	embed.addFields({ name: "Recent Commits", value: recentCommitsText });
		// }

		await interaction.editReply({ embeds: [embed] });
	} catch (error) {
		console.error("Error fetching commit overflow profile:", error);
		await interaction.editReply({
			content: "Failed to fetch profile. Please try again.",
		});
	}
}
