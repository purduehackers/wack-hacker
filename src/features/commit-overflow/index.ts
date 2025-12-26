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
import { distance } from "fastest-levenshtein";

import {
    COMMIT_OVERFLOW_FORUM_ID,
    COMMIT_OVERFLOW_FORWARD_THREAD_ID,
    COMMIT_OVERFLOW_ROLE_ID,
    COMMIT_OVERFLOW_YEAR,
    COMMIT_OVERFLOW_DEFAULT_TIMEZONE,
    ALTERNATE_COMMIT_APPROVE_EMOJI,
    COMMIT_APPROVE_EMOJI,
    COMMIT_PIN_EMOJI,
    COMMIT_PRIVATE_EMOJI,
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
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName("share")
            .setDescription("Set whether your commit overflow profile is publicly visible")
            .addStringOption((option) =>
                option
                    .setName("visibility")
                    .setDescription("Enable or disable public sharing of your profile")
                    .setRequired(true)
                    .addChoices(
                        { name: "enabled", value: "enabled" },
                        { name: "disabled", value: "disabled" },
                    ),
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
        .setFooter({
            text: `${COMMIT_APPROVE_EMOJI} Commit Overflow ${COMMIT_OVERFLOW_YEAR} • ${timezone}`,
        })
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

const handleShare = Effect.fn("CommitOverflow.handleShare")(function* (
    interaction: ChatInputCommandInteraction,
) {
    const startTime = Date.now();
    const db = yield* Database;
    const userId = interaction.user.id;
    const visibility = interaction.options.getString("visibility", true);
    const newPrivate = visibility === "disabled";

    yield* Effect.annotateCurrentSpan({
        user_id: userId,
        visibility,
    });

    const profileOpt = yield* db.commitOverflowProfiles.get(userId);
    if (Option.isNone(profileOpt)) {
        yield* Effect.logWarning("user not in commit overflow", {
            user_id: userId,
            visibility,
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

    const currentProfile = profileOpt.value;
    const wasPrivate = currentProfile.is_private ?? false;

    yield* db.commitOverflowProfiles.setPrivate(userId, newPrivate);

    // Update all commits based on new privacy setting
    // When going private: all commits become private
    // When going public: only non-explicitly-private commits become public
    yield* db.commits.bulkSetPrivate(userId, newPrivate, !newPrivate);

    const durationMs = Date.now() - startTime;
    yield* Effect.logInfo("profile sharing updated", {
        user_id: userId,
        username: interaction.user.username,
        visibility,
        was_private: wasPrivate,
        is_private: newPrivate,
        duration_ms: durationMs,
    });

    const responseMessage = newPrivate
        ? `Your profile is now **private**. Your commits will not be shared publicly. ${COMMIT_PRIVATE_EMOJI}`
        : `Your profile is now **public**. Your commits will be shared. ${COMMIT_APPROVE_EMOJI}`;

    yield* Effect.tryPromise({
        try: () =>
            interaction.reply({
                content: responseMessage,
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
        } else if (subcommand === "share") {
            yield* handleShare(interaction);
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
    const isApproveEmoji =
        reaction.emoji.name === COMMIT_APPROVE_EMOJI ||
        reaction.emoji.id === ALTERNATE_COMMIT_APPROVE_EMOJI;
    if (!isApproveEmoji) return;
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

    // Skip if this is the thread's starter message (default emoji gets auto-added)
    if (message.id === thread.id) {
        yield* Effect.logDebug("skipping starter message reaction", {
            user_id: user.id,
            message_id: message.id,
            thread_id: thread.id,
            reason: "starter_message",
        });
        return;
    }

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

    const threadOwnerId = thread.ownerId;
    if (!threadOwnerId) return;

    const threadOwner = yield* Effect.tryPromise({
        try: () => guild.members.fetch(threadOwnerId),
        catch: (e) =>
            new Error(`Failed to fetch thread owner: ${e instanceof Error ? e.message : String(e)}`),
    });

    yield* db.users.upsert(threadOwnerId, threadOwner.user.username);

    const ownerProfileOpt = yield* db.commitOverflowProfiles.get(threadOwnerId);
    const isPrivate = Option.isSome(ownerProfileOpt)
        ? (ownerProfileOpt.value.is_private ?? false)
        : false;
    const hasPrivateEmoji = message.reactions.cache.some(
        (r) => r.emoji.name === COMMIT_PRIVATE_EMOJI,
    );

    const committedAt = message.createdAt.toISOString();
    yield* db.commits.createApproved({
        userId: threadOwnerId,
        messageId: message.id,
        committedAt,
        approvedBy: user.id,
        isPrivate,
    });

    if (hasPrivateEmoji) {
        yield* db.commits.setExplicitlyPrivate(message.id, true);
    }

    let forwardedMessageId: string | null = null;
    if (!isPrivate || hasPrivateEmoji) {
        const forwardResult = yield* Effect.tryPromise({
            try: () => message.forward(COMMIT_OVERFLOW_FORWARD_THREAD_ID),
            catch: (e) =>
                new Error(`Failed to forward message: ${e instanceof Error ? e.message : String(e)}`),
        }).pipe(
            Effect.map((forwardedMessage) => forwardedMessage.id),
            Effect.catchAll((error) => {
                return Effect.logWarning("failed to forward commit", {
                    message_id: message.id,
                    user_id: threadOwnerId,
                    error_message: error.message,
                }).pipe(Effect.map(() => null));
            }),
        );
        forwardedMessageId = forwardResult;
    }

    const durationMs = Date.now() - startTime;
    yield* Effect.logInfo("commit approved", {
        user_id: threadOwnerId,
        username: threadOwner.user.username,
        message_author_id: message.author?.id,
        approver_id: user.id,
        message_id: message.id,
        committed_at: committedAt,
        is_private: isPrivate,
        already_has_explicitly_private: hasPrivateEmoji,
        forwarded: !isPrivate || !hasPrivateEmoji,
        forwarded_message_id: forwardedMessageId,
        duration_ms: durationMs,
    });

    yield* Effect.tryPromise({
        try: () => message.react("\u2705"),
        catch: (e) => new Error(`Failed to react: ${e instanceof Error ? e.message : String(e)}`),
    });
});

const handlePrivateReaction = Effect.fn("CommitOverflow.handlePrivateReaction")(function* (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
) {
    const startTime = Date.now();
    const db = yield* Database;

    if (user.bot) return;
    if (reaction.emoji.name !== COMMIT_PRIVATE_EMOJI) return;
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

    const thread = message.channel as ThreadChannel;
    const isThreadOwner = thread.ownerId === user.id;

    if (!isThreadOwner) {
        yield* Effect.logDebug("unauthorized private toggle attempt", {
            user_id: user.id,
            message_id: message.id,
            thread_owner_id: thread.ownerId,
            reason: "not_thread_owner",
        });
        return;
    }

    const existingCommit = yield* db.commits.get(message.id);
    if (Option.isNone(existingCommit)) {
        yield* Effect.logDebug("commit not found for private toggle", {
            user_id: user.id,
            message_id: message.id,
            reason: "commit_not_approved",
        });
        return;
    }

    yield* db.commits.setExplicitlyPrivate(message.id, true);

    const durationMs = Date.now() - startTime;
    yield* Effect.logInfo("commit marked explicitly private", {
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

const handleApproveReactionRemove = Effect.fn("CommitOverflow.handleApproveReactionRemove")(
    function* (
        reaction: MessageReaction | PartialMessageReaction,
        user: User | PartialUser,
    ) {
        const startTime = Date.now();
        const db = yield* Database;

        if (user.bot) return;
        const isApproveEmoji =
            reaction.emoji.name === COMMIT_APPROVE_EMOJI ||
            reaction.emoji.id === ALTERNATE_COMMIT_APPROVE_EMOJI;
        if (!isApproveEmoji) return;
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

        // Check if there are still other approve reactions on the message
        const approveReactions = message.reactions.cache.filter(
            (r) =>
                r.emoji.name === COMMIT_APPROVE_EMOJI ||
                r.emoji.id === ALTERNATE_COMMIT_APPROVE_EMOJI,
        );
        const hasOtherApproveReactions = approveReactions.some((r) => (r.count ?? 0) > 0);

        if (hasOtherApproveReactions) {
            yield* Effect.logDebug("other approve reactions still exist", {
                user_id: user.id,
                message_id: message.id,
                reason: "other_approves_exist",
            });
            return;
        }

        const existingCommit = yield* db.commits.get(message.id);
        if (Option.isNone(existingCommit)) {
            yield* Effect.logDebug("commit not found for approve removal", {
                user_id: user.id,
                message_id: message.id,
                reason: "commit_not_found",
            });
            return;
        }

        yield* db.commits.delete(message.id);

        // Remove the checkmark reaction if present
        const checkReaction = message.reactions.cache.get("\u2705");
        if (checkReaction) {
            yield* Effect.tryPromise({
                try: () => checkReaction.users.remove(message.client.user?.id),
                catch: (e) =>
                    new Error(
                        `Failed to remove reaction: ${e instanceof Error ? e.message : String(e)}`,
                    ),
            }).pipe(Effect.catchAll(() => Effect.void));
        }

        const durationMs = Date.now() - startTime;
        yield* Effect.logInfo("commit unapproved and deleted", {
            user_id: user.id,
            message_id: message.id,
            message_author_id: message.author?.id,
            duration_ms: durationMs,
        });
    },
);

const handlePrivateReactionRemove = Effect.fn("CommitOverflow.handlePrivateReactionRemove")(
    function* (
        reaction: MessageReaction | PartialMessageReaction,
        user: User | PartialUser,
    ) {
        const startTime = Date.now();
        const db = yield* Database;

        if (user.bot) return;
        if (reaction.emoji.name !== COMMIT_PRIVATE_EMOJI) return;
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

        const thread = message.channel as ThreadChannel;
        const isThreadOwner = thread.ownerId === user.id;

        if (!isThreadOwner) {
            yield* Effect.logDebug("unauthorized private toggle removal attempt", {
                user_id: user.id,
                message_id: message.id,
                thread_owner_id: thread.ownerId,
                reason: "not_thread_owner",
            });
            return;
        }

        const existingCommit = yield* db.commits.get(message.id);
        if (Option.isNone(existingCommit)) {
            yield* Effect.logDebug("commit not found for private toggle removal", {
                user_id: user.id,
                message_id: message.id,
                reason: "commit_not_approved",
            });
            return;
        }

        const threadOwnerId = thread.ownerId;
        if (!threadOwnerId) return;

        const ownerProfileOpt = yield* db.commitOverflowProfiles.get(threadOwnerId);
        const profileIsPrivate = Option.isSome(ownerProfileOpt)
            ? (ownerProfileOpt.value.is_private ?? false)
            : false;

        yield* db.commits.setExplicitlyPrivate(message.id, false);

        const durationMs = Date.now() - startTime;
        yield* Effect.logInfo("commit explicit privacy removed", {
            user_id: user.id,
            message_id: message.id,
            thread_owner_id: threadOwnerId,
            message_author_id: message.author?.id,
            profile_is_private: profileIsPrivate,
            commit_is_private: profileIsPrivate,
            duration_ms: durationMs,
        });
    },
);

export const handleCommitOverflowReaction = (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
) =>
    Effect.all(
        [
            handlePinReaction(reaction, user),
            handleApproveReaction(reaction, user),
            handlePrivateReaction(reaction, user),
        ],
        {
            concurrency: "unbounded",
            mode: "either",
        },
    ).pipe(Effect.asVoid, Effect.annotateLogs({ feature: "commit_overflow" }));

export const handleCommitOverflowReactionRemove = (
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
) =>
    Effect.all(
        [
            handleApproveReactionRemove(reaction, user),
            handlePrivateReactionRemove(reaction, user),
        ],
        {
            concurrency: "unbounded",
            mode: "either",
        },
    ).pipe(Effect.asVoid, Effect.annotateLogs({ feature: "commit_overflow" }));

export const handleCommitOverflowMessageDelete = Effect.fn("CommitOverflow.handleMessageDelete")(
    function* (message: Message) {
        const startTime = Date.now();
        const db = yield* Database;

        if (!isInCommitOverflowForum(message.channel)) return;

        yield* Effect.annotateCurrentSpan({
            message_id: message.id,
            channel_id: message.channelId,
        });

        const existingCommit = yield* db.commits.get(message.id);
        if (Option.isNone(existingCommit)) {
            yield* Effect.logDebug("no commit found for deleted message", {
                message_id: message.id,
                channel_id: message.channelId,
                reason: "commit_not_found",
            });
            return;
        }

        yield* db.commits.delete(message.id);

        const durationMs = Date.now() - startTime;
        yield* Effect.logInfo("commit deleted due to message deletion", {
            message_id: message.id,
            channel_id: message.channelId,
            author_id: message.author?.id,
            duration_ms: durationMs,
        });
    },
    Effect.annotateLogs({ feature: "commit_overflow" }),
);

export { calculateStreaks } from "./streaks";

const WACK_HACKER_BOT_ID = "1115068381649961060";
const SANTA_HAT_TRIGGER = "do you like your santa hat";
const LEVENSHTEIN_THRESHOLD = 5;
const WACKMAS_RESPONSE = "yes yes yes!!! merry wackmas!!";

export const handleWackmas = Effect.fn("Wackmas.handle")(
    function* (message: Message) {
        const startTime = Date.now();

        if (message.author.bot) return;
        if (!message.mentions.has(WACK_HACKER_BOT_ID)) return;

        const normalizedContent = message.content
            .replace(/<@!?\d+>/g, "")
            .toLowerCase()
            .replace(/[?!.,]/g, "")
            .trim();
        const levenshteinDistance = distance(SANTA_HAT_TRIGGER, normalizedContent);

        if (levenshteinDistance > LEVENSHTEIN_THRESHOLD) return;

        yield* Effect.logInfo("wackmas message detected", {
            channel_id: message.channelId,
            message_id: message.id,
            user_id: message.author.id,
            user_display_name: message.author.displayName,
            content_preview: message.content.slice(0, 50),
            levenshtein_distance: levenshteinDistance,
        });

        yield* Effect.tryPromise({
            try: () => message.reply(WACKMAS_RESPONSE),
            catch: (e) =>
                new Error(`Failed to reply: ${e instanceof Error ? e.message : String(e)}`),
        }).pipe(
            Effect.tap(() =>
                Effect.logInfo("wackmas response sent", {
                    channel_id: message.channelId,
                    message_id: message.id,
                    user_id: message.author.id,
                    response: WACKMAS_RESPONSE,
                    duration_ms: Date.now() - startTime,
                }),
            ),
            Effect.catchAll((error) =>
                Effect.logError("wackmas response failed", {
                    channel_id: message.channelId,
                    message_id: message.id,
                    user_id: message.author.id,
                    error_message: error.message,
                    duration_ms: Date.now() - startTime,
                }),
            ),
        );
    },
    Effect.annotateLogs({ feature: "wackmas" }),
);
