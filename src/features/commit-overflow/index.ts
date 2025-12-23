import type { ForumChannel, AnyThreadChannel } from "discord.js";

import {
    SlashCommandBuilder,
    ChannelType,
    EmbedBuilder,
    MessageFlags,
    type ChatInputCommandInteraction,
    type Message,
    type MessageReaction,
    type PartialMessageReaction,
    type User,
    type PartialUser,
    type ThreadChannel,
} from "discord.js";
import { Effect, Option } from "effect";

import {
    COMMIT_OVERFLOW_FORUM_ID,
    COMMIT_OVERFLOW_ROLE_ID,
    COMMIT_OVERFLOW_YEAR,
    COMMIT_OVERFLOW_DEFAULT_TIMEZONE,
    COMMIT_APPROVE_EMOJI,
    COMMIT_PIN_EMOJI,
    ORGANIZER_ROLE_ID,
    BISHOP_ROLE_ID,
} from "../../constants";
import { Database } from "../../services";
import { calculateStreaks, getDistinctCommitDays } from "./streaks";

export const commitOverflowCommand = new SlashCommandBuilder()
    .setName("commit-overflow")
    .setDescription("Commit Overflow event commands")
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
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName("timezone")
            .setDescription("Set your timezone for streak calculations")
            .addStringOption((option) =>
                option
                    .setName("timezone")
                    .setDescription("Your timezone (e.g., America/New_York, America/Los_Angeles)")
                    .setRequired(true),
            ),
    );

const isInCommitOverflowForum = (channel: Message["channel"]): boolean => {
    if (!channel.isThread()) return false;
    return channel.parentId === COMMIT_OVERFLOW_FORUM_ID;
};

export const handleCommitOverflowThreadCreate = Effect.fn("CommitOverflow.handleThreadCreate")(
    function* (thread: AnyThreadChannel, newlyCreated: boolean) {
        const startTime = Date.now();

        if (!newlyCreated) return;
        if (thread.parentId !== COMMIT_OVERFLOW_FORUM_ID) return;
        if (!thread.ownerId) return;

        const db = yield* Database;
        const userId = thread.ownerId;
        const threadId = thread.id;
        const threadName = thread.name;

        yield* Effect.annotateCurrentSpan({
            user_id: userId,
            thread_id: threadId,
            thread_name: threadName,
        });

        yield* Effect.logDebug("handling commit overflow thread create", {
            user_id: userId,
            thread_id: threadId,
            thread_name: threadName,
        });

        const existingProfileOpt = yield* db.commitOverflowProfiles.get(userId);

        if (Option.isSome(existingProfileOpt)) {
            const existingProfile = existingProfileOpt.value;

            if (existingProfile.thread_id === threadId) {
                yield* Effect.logDebug("thread already registered for user", {
                    user_id: userId,
                    thread_id: threadId,
                });
                return;
            }

            const existingThreadId = existingProfile.thread_id;
            yield* Effect.logInfo("found existing profile", {
                user_id: userId,
                existing_thread_id: existingThreadId,
                new_thread_id: threadId,
            });

            if (!existingThreadId) {
                yield* Effect.logWarning("existing profile has no thread_id, cleaning up", {
                    user_id: userId,
                    new_thread_id: threadId,
                });
                yield* db.commits.deleteByUser(userId);
                yield* db.commitOverflowProfiles.delete(userId);
            } else {
                const forum = thread.parent;
                if (forum && forum.type === ChannelType.GuildForum) {
                    const forumChannel = forum as ForumChannel;

                    const oldThread = yield* Effect.tryPromise({
                        try: () => forumChannel.threads.fetch(existingThreadId),
                        catch: () => null,
                    }).pipe(Effect.catchAll(() => Effect.succeed(null)));

                    if (oldThread) {
                        yield* Effect.logInfo(
                            "user already has existing thread, deleting duplicate",
                            {
                                user_id: userId,
                                existing_thread_id: existingThreadId,
                                new_thread_id: threadId,
                                duration_ms: Date.now() - startTime,
                            },
                        );

                        const starterMessage = yield* Effect.tryPromise({
                            try: () => thread.fetchStarterMessage(),
                            catch: () => null,
                        }).pipe(Effect.catchAll(() => Effect.succeed(null)));

                        const messageContent = starterMessage?.content || "";
                        const escapedContent = messageContent.replace(/```/g, "`\u200b``");
                        const attachmentUrls =
                            starterMessage?.attachments.map((a) => a.url).join("\n") || "";

                        const reminderMessage =
                            `Hey <@${userId}>! You tried to create a new Commit Overflow thread, but you already have one here!\n\n` +
                            `I've saved your message for you:\n` +
                            (escapedContent ? `\`\`\`${escapedContent}\`\`\`\n` : "") +
                            (attachmentUrls ? `Attachments:\n${attachmentUrls}\n` : "") +
                            `\nPlease post your commits in this thread instead! :)`;

                        const notificationSent = yield* Effect.tryPromise({
                            try: async () => {
                                await oldThread.send(reminderMessage);
                                return true;
                            },
                            catch: () => false as const,
                        }).pipe(Effect.catchAll(() => Effect.succeed(false)));

                        if (notificationSent) {
                            yield* Effect.tryPromise({
                                try: async () => {
                                    await thread.delete();
                                },
                                catch: (e) =>
                                    new Error(
                                        `Failed to delete thread: ${e instanceof Error ? e.message : String(e)}`,
                                    ),
                            });

                            yield* Effect.logInfo(
                                "duplicate thread deleted and user notified in original",
                                {
                                    user_id: userId,
                                    existing_thread_id: existingThreadId,
                                    deleted_thread_id: threadId,
                                    had_message_content: messageContent.length > 0,
                                    had_attachments: attachmentUrls.length > 0,
                                    duration_ms: Date.now() - startTime,
                                },
                            );
                        } else {
                            yield* Effect.logWarning(
                                "failed to notify user, keeping duplicate thread",
                                {
                                    user_id: userId,
                                    existing_thread_id: existingThreadId,
                                    new_thread_id: threadId,
                                },
                            );
                        }

                        return;
                    }

                    yield* Effect.logInfo("old thread no longer exists, cleaning up user records", {
                        user_id: userId,
                        old_thread_id: existingThreadId,
                        new_thread_id: threadId,
                    });
                    yield* db.commits.deleteByUser(userId);
                    yield* db.commitOverflowProfiles.delete(userId);
                }
            }
        }

        const guild = thread.guild;
        const member = yield* Effect.tryPromise({
            try: () => guild.members.fetch(userId),
            catch: (e) =>
                new Error(`Failed to fetch member: ${e instanceof Error ? e.message : String(e)}`),
        });

        yield* Effect.tryPromise({
            try: () => member.roles.add(COMMIT_OVERFLOW_ROLE_ID),
            catch: (e) =>
                new Error(`Failed to add role: ${e instanceof Error ? e.message : String(e)}`),
        });

        yield* Effect.tryPromise({
            try: async () => {
                const infoMessage = await thread.send({
                    content: `${COMMIT_APPROVE_EMOJI} **Welcome to Commit Overflow!**

• Share your progress by posting GitHub commits, code screenshots, or updates
• React with ${COMMIT_PIN_EMOJI} to pin important messages
• You or organizers can react with ${COMMIT_APPROVE_EMOJI} to approve commits toward your streak`,
                });
                await infoMessage.pin();
            },
            catch: (e) =>
                new Error(
                    `Failed to send welcome message: ${e instanceof Error ? e.message : String(e)}`,
                ),
        });

        yield* db.users.upsert(userId, member.user.username);
        yield* db.commitOverflowProfiles.create(userId, threadId);

        const durationMs = Date.now() - startTime;
        yield* Effect.logInfo("commit overflow thread setup complete", {
            user_id: userId,
            username: member.user.username,
            thread_id: threadId,
            thread_name: threadName,
            duration_ms: durationMs,
        });
    },
    Effect.annotateLogs({ feature: "commit_overflow" }),
);

const handleView = Effect.fn("CommitOverflow.handleView")(function* (
    interaction: ChatInputCommandInteraction,
) {
    const startTime = Date.now();
    const db = yield* Database;
    const targetUser = interaction.options.getUser("user") ?? interaction.user;
    const isViewingSelf = targetUser.id === interaction.user.id;

    yield* Effect.annotateCurrentSpan({
        user_id: interaction.user.id,
        target_user_id: targetUser.id,
        is_viewing_self: isViewingSelf,
    });
    yield* Effect.logDebug("handling commit overflow view command", {
        user_id: interaction.user.id,
        target_user_id: targetUser.id,
        target_username: targetUser.username,
        is_viewing_self: isViewingSelf,
    });

    if (!isViewingSelf) {
        const member = interaction.member;
        const memberRoles = member && "cache" in member.roles ? member.roles.cache : null;
        const isOrganizer = memberRoles?.has(ORGANIZER_ROLE_ID) ?? false;
        const isBishop = memberRoles?.has(BISHOP_ROLE_ID) ?? false;

        if (!isOrganizer && !isBishop) {
            const durationMs = Date.now() - startTime;
            yield* Effect.logWarning("unauthorized profile view attempt", {
                user_id: interaction.user.id,
                target_user_id: targetUser.id,
                duration_ms: durationMs,
            });
            yield* Effect.tryPromise({
                try: () =>
                    interaction.reply({
                        content:
                            "You can only view your own profile. Organizers can view anyone's profile.",
                        flags: MessageFlags.Ephemeral,
                    }),
                catch: (e) =>
                    new Error(`Failed to reply: ${e instanceof Error ? e.message : String(e)}`),
            });
            return;
        }
    }

    const forum = interaction.client.channels.cache.get(COMMIT_OVERFLOW_FORUM_ID);
    if (!forum || forum.type !== ChannelType.GuildForum) {
        const durationMs = Date.now() - startTime;
        yield* Effect.logError("commit overflow forum not found", {
            user_id: interaction.user.id,
            target_user_id: targetUser.id,
            duration_ms: durationMs,
            forum_id: COMMIT_OVERFLOW_FORUM_ID,
        });
        yield* Effect.tryPromise({
            try: () =>
                interaction.reply({
                    content: "Could not find the Commit Overflow forum channel.",
                    flags: MessageFlags.Ephemeral,
                }),
            catch: (e) =>
                new Error(`Failed to reply: ${e instanceof Error ? e.message : String(e)}`),
        });
        return;
    }

const forumChannel = forum as ForumChannel;

	const initialProfileOpt = yield* db.commitOverflowProfiles.get(targetUser.id);

	let profileExists = Option.isSome(initialProfileOpt);

	if (Option.isSome(initialProfileOpt)) {
		const threadId = initialProfileOpt.value.thread_id;
		const threadExists = yield* Effect.tryPromise({
			try: async () => {
				const thread = await forumChannel.threads.fetch(threadId);
				return thread !== null;
			},
			catch: () => false as const,
		}).pipe(Effect.catchAll(() => Effect.succeed(false)));

		if (!threadExists) {
			yield* Effect.logInfo("thread no longer exists cleaning up user records", {
				user_id: targetUser.id,
				username: targetUser.username,
				thread_id: threadId,
			});
			yield* db.commits.deleteByUser(targetUser.id);
			yield* db.commitOverflowProfiles.delete(targetUser.id);
			profileExists = false;
		}
	}

	if (!profileExists) {
		const durationMs = Date.now() - startTime;
		yield* Effect.logInfo("user not found in commit overflow", {
			user_id: interaction.user.id,
			target_user_id: targetUser.id,
			target_username: targetUser.username,
			is_viewing_self: isViewingSelf,
			duration_ms: durationMs,
		});
		yield* Effect.tryPromise({
			try: () =>
				interaction.reply({
					content: isViewingSelf
						? "You haven't joined Commit Overflow yet! Join by creating a thread in <#1452388241796894941>."
						: `${targetUser.username} hasn't participated in Commit Overflow yet.`,
					flags: MessageFlags.Ephemeral,
				}),
			catch: (e) =>
				new Error(`Failed to reply: ${e instanceof Error ? e.message : String(e)}`),
		});
		return;
	}

	yield* Effect.tryPromise({
		try: () => interaction.deferReply(),
		catch: (e) => new Error(`Failed to defer: ${e instanceof Error ? e.message : String(e)}`),
	});

    const profileOpt = yield* db.commitOverflowProfiles.get(targetUser.id);
    const timezone = Option.isSome(profileOpt)
        ? profileOpt.value.timezone
        : COMMIT_OVERFLOW_DEFAULT_TIMEZONE;

    const [totalCommits, commitTimestamps] = yield* Effect.all([
        db.commits.getApprovedCount(targetUser.id),
        db.commits.getCommitTimestamps(targetUser.id),
    ]);

    const commitDays = getDistinctCommitDays(commitTimestamps, timezone);
    const { currentStreak, longestStreak } = calculateStreaks(commitTimestamps, timezone);
    const streakEmoji = currentStreak >= 3 ? " \u{1F525}" : "";

    const durationMs = Date.now() - startTime;
    yield* Effect.logInfo("profile viewed", {
        user_id: interaction.user.id,
        target_user_id: targetUser.id,
        target_username: targetUser.username,
        is_viewing_self: isViewingSelf,
        total_commits: totalCommits,
        commit_days: commitDays.length,
        current_streak: currentStreak,
        longest_streak: longestStreak,
        duration_ms: durationMs,
    });

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
            {
                name: "Current Streak",
                value: `${currentStreak} day${currentStreak !== 1 ? "s" : ""}${streakEmoji}`,
                inline: true,
            },
            {
                name: "Longest Streak",
                value: `${longestStreak} day${longestStreak !== 1 ? "s" : ""}`,
                inline: true,
            },
            { name: "\u200b", value: "\u200b", inline: true },
        )
        .setFooter({ text: `${COMMIT_APPROVE_EMOJI} Commit Overflow ${COMMIT_OVERFLOW_YEAR} • ${timezone}` })
        .setTimestamp();

    yield* Effect.tryPromise({
        try: () => interaction.editReply({ embeds: [embed] }),
        catch: (e) =>
            new Error(`Failed to edit reply: ${e instanceof Error ? e.message : String(e)}`),
    });
});

const handleTimezone = Effect.fn("CommitOverflow.handleTimezone")(function* (
    interaction: ChatInputCommandInteraction,
) {
    const startTime = Date.now();
    const db = yield* Database;
    const userId = interaction.user.id;
    const timezone = interaction.options.getString("timezone", true);

    yield* Effect.annotateCurrentSpan({
        user_id: userId,
        timezone,
    });

    const validTimezones = Intl.supportedValuesOf("timeZone");
    if (!validTimezones.includes(timezone)) {
        yield* Effect.logWarning("invalid timezone provided", {
            user_id: userId,
            timezone,
            duration_ms: Date.now() - startTime,
        });
        yield* Effect.tryPromise({
            try: () =>
                interaction.reply({
                    content: `Invalid timezone: \`${timezone}\`. Please use a valid IANA timezone like \`America/New_York\` or \`America/Los_Angeles\`.`,
                    flags: MessageFlags.Ephemeral,
                }),
            catch: (e) =>
                new Error(`Failed to reply: ${e instanceof Error ? e.message : String(e)}`),
        });
        return;
    }

    const profileOpt = yield* db.commitOverflowProfiles.get(userId);
    if (Option.isNone(profileOpt)) {
        yield* Effect.logWarning("user not in commit overflow", {
            user_id: userId,
            timezone,
            duration_ms: Date.now() - startTime,
        });
        yield* Effect.tryPromise({
            try: () =>
                interaction.reply({
                    content:
                        "You haven't started Commit Overflow yet. Create a thread in the forum first!",
                    flags: MessageFlags.Ephemeral,
                }),
            catch: (e) =>
                new Error(`Failed to reply: ${e instanceof Error ? e.message : String(e)}`),
        });
        return;
    }

    yield* db.commitOverflowProfiles.setTimezone(userId, timezone);

    const durationMs = Date.now() - startTime;
    yield* Effect.logInfo("timezone updated", {
        user_id: userId,
        username: interaction.user.username,
        timezone,
        duration_ms: durationMs,
    });

    yield* Effect.tryPromise({
        try: () =>
            interaction.reply({
                content: `Your timezone has been set to \`${timezone}\`. Streak calculations will now use this timezone with the day resetting at 6am.`,
                flags: MessageFlags.Ephemeral,
            }),
        catch: (e) => new Error(`Failed to reply: ${e instanceof Error ? e.message : String(e)}`),
    });
});

export const handleCommitOverflowCommand = Effect.fn("CommitOverflow.handleCommand")(
    function* (interaction: ChatInputCommandInteraction) {
        const subcommand = interaction.options.getSubcommand();

        yield* Effect.annotateCurrentSpan({
            user_id: interaction.user.id,
            subcommand,
        });

        if (subcommand === "view") {
            yield* handleView(interaction);
        } else if (subcommand === "timezone") {
            yield* handleTimezone(interaction);
        }
    },
    Effect.annotateLogs({ feature: "commit_overflow" }),
);

const handlePinReaction = Effect.fn("CommitOverflow.handlePinReaction")(function* (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
) {
    const startTime = Date.now();

    if (user.bot) return;
    if (reaction.emoji.name !== COMMIT_PIN_EMOJI) return;
    if (!isInCommitOverflowForum(reaction.message.channel)) return;

    yield* Effect.annotateCurrentSpan({
        user_id: user.id,
        message_id: reaction.message.id,
    });

    const fullReaction = reaction.partial
        ? yield* Effect.tryPromise({
              try: () => reaction.fetch(),
              catch: (e) =>
                  new Error(
                      `Failed to fetch reaction: ${e instanceof Error ? e.message : String(e)}`,
                  ),
          })
        : reaction;

    const message = fullReaction.message.partial
        ? yield* Effect.tryPromise({
              try: () => fullReaction.message.fetch(),
              catch: (e) =>
                  new Error(
                      `Failed to fetch message: ${e instanceof Error ? e.message : String(e)}`,
                  ),
          })
        : fullReaction.message;

    if (!message.pinnable) {
        yield* Effect.logDebug("message not pinnable", {
            user_id: user.id,
            message_id: message.id,
        });
        return;
    }

    yield* Effect.tryPromise({
        try: () => message.pin(),
        catch: (e) =>
            new Error(`Failed to pin message: ${e instanceof Error ? e.message : String(e)}`),
    });

    const durationMs = Date.now() - startTime;
    yield* Effect.logInfo("message pinned", {
        user_id: user.id,
        message_id: message.id,
        author_id: message.author?.id,
        duration_ms: durationMs,
    });

    yield* Effect.tryPromise({
        try: () => message.react("\u2705"),
        catch: (e) => new Error(`Failed to react: ${e instanceof Error ? e.message : String(e)}`),
    });
});

const handleApproveReaction = Effect.fn("CommitOverflow.handleApproveReaction")(function* (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
) {
    const startTime = Date.now();
    const db = yield* Database;

    if (user.bot) return;
    if (reaction.emoji.name !== COMMIT_APPROVE_EMOJI) return;
    if (!isInCommitOverflowForum(reaction.message.channel)) return;

    yield* Effect.annotateCurrentSpan({
        user_id: user.id,
        message_id: reaction.message.id,
    });

    const fullReaction = reaction.partial
        ? yield* Effect.tryPromise({
              try: () => reaction.fetch(),
              catch: (e) =>
                  new Error(
                      `Failed to fetch reaction: ${e instanceof Error ? e.message : String(e)}`,
                  ),
          })
        : reaction;

    const message = fullReaction.message.partial
        ? yield* Effect.tryPromise({
              try: () => fullReaction.message.fetch(),
              catch: (e) =>
                  new Error(
                      `Failed to fetch message: ${e instanceof Error ? e.message : String(e)}`,
                  ),
          })
        : fullReaction.message;

    const guild = message.guild;
    if (!guild) return;

    const member = yield* Effect.tryPromise({
        try: () => guild.members.fetch(user.id),
        catch: (e) =>
            new Error(`Failed to fetch member: ${e instanceof Error ? e.message : String(e)}`),
    });

    const isOrganizer = member.roles.cache.has(ORGANIZER_ROLE_ID);
    const isBishop = member.roles.cache.has(BISHOP_ROLE_ID);

    const thread = message.channel as ThreadChannel;
    const isThreadOwner = thread.ownerId === user.id;

    if (!isOrganizer && !isBishop && !isThreadOwner) {
        yield* Effect.logDebug("unauthorized approval attempt", {
            user_id: user.id,
            message_id: message.id,
            is_organizer: isOrganizer,
            is_bishop: isBishop,
            is_thread_owner: isThreadOwner,
        });
        return;
    }

    const existingCommit = yield* db.commits.get(message.id);
    if (Option.isSome(existingCommit)) {
        yield* Effect.logDebug("commit already approved", {
            user_id: user.id,
            message_id: message.id,
            author_id: message.author?.id,
        });
        return;
    }

    const author = message.author;
    if (!author) return;

    yield* db.users.upsert(author.id, author.username);

    const committedAt = message.createdAt.toISOString();
    yield* db.commits.createApproved({
        userId: author.id,
        messageId: message.id,
        committedAt,
        approvedBy: user.id,
    });

    const durationMs = Date.now() - startTime;
    yield* Effect.logInfo("commit approved", {
        user_id: author.id,
        username: author.username,
        approver_id: user.id,
        message_id: message.id,
        committed_at: committedAt,
        duration_ms: durationMs,
    });

    yield* Effect.tryPromise({
        try: () => message.react("\u2705"),
        catch: (e) => new Error(`Failed to react: ${e instanceof Error ? e.message : String(e)}`),
    });
});

export const handleCommitOverflowReaction = (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
) =>
    Effect.all([handlePinReaction(reaction, user), handleApproveReaction(reaction, user)], {
        concurrency: "unbounded",
        mode: "either",
    }).pipe(Effect.asVoid, Effect.annotateLogs({ feature: "commit_overflow" }));

export { calculateStreaks } from "./streaks";
