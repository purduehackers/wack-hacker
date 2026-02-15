import { Vercel } from "@vercel/sdk";
import {
    SlashCommandBuilder,
    MessageFlags,
    ChannelType,
    ThreadAutoArchiveDuration,
    type ChatInputCommandInteraction,
    type Message,
    type Client,
    type TextChannel,
} from "discord.js";
import { Duration, Effect, Option, Redacted, Schedule } from "effect";

import { AppConfig } from "../../config";
import {
    HACK_NIGHT_CHANNEL_ID,
    HACK_NIGHT_PING_ROLE_ID,
    HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID,
    HACK_NIGHT_MESSAGES,
    ORGANIZER_ROLE_ID,
} from "../../constants";
import { structuredError } from "../../errors";
import { generateEventSlug } from "../../lib/dates";
import { randomItem } from "../../lib/discord";
import { Storage } from "../../services";

export const handleHackNightImages = Effect.fn("HackNight.handleImages")(
    function* (message: Message) {
        const startTime = Date.now();
        const storage = yield* Storage;

        if (message.author.bot) {
            yield* Effect.logDebug("message filtered bot_message=true", {
                message_id: message.id,
                channel_id: message.channelId,
                user_id: message.author.id,
            });
            return;
        }

        if (!message.channel.isThread()) {
            yield* Effect.logDebug("message filtered not_thread=true", {
                message_id: message.id,
                channel_id: message.channelId,
                channel_type: message.channel.type,
            });
            return;
        }

        if (!message.channel.name.startsWith("Hack Night Images - ")) {
            yield* Effect.logDebug("message filtered wrong_thread_prefix=true", {
                message_id: message.id,
                channel_id: message.channelId,
                thread_name: message.channel.name,
            });
            return;
        }

        if (message.attachments.size === 0) {
            yield* Effect.logDebug("message filtered no_attachments=true", {
                message_id: message.id,
                channel_id: message.channelId,
                user_id: message.author.id,
            });
            return;
        }

        const threadStartDate = message.channel.createdAt;
        if (!threadStartDate) {
            yield* Effect.logWarning("thread missing created_at timestamp", {
                message_id: message.id,
                channel_id: message.channelId,
                thread_id: message.channel.id,
                thread_name: message.channel.name,
            });
            return;
        }

        yield* Effect.annotateCurrentSpan({
            user_id: message.author.id,
            message_id: message.id,
            attachment_count: message.attachments.size,
            channel_id: message.channelId,
            thread_id: message.channel.id,
        });

        const eventSlug = yield* generateEventSlug(threadStartDate);

        const [checkDuration, alreadyUploaded] = yield* Effect.timed(
            storage.isImageUploaded(eventSlug, message.id),
        );

        yield* Effect.logDebug("duplicate check completed", {
            event_slug: eventSlug,
            message_id: message.id,
            already_uploaded: alreadyUploaded,
            duration_ms: Duration.toMillis(checkDuration),
        });

        if (alreadyUploaded) {
            yield* Effect.logInfo("skipping duplicate message", {
                event_slug: eventSlug,
                message_id: message.id,
                channel_id: message.channelId,
                user_id: message.author.id,
                attachment_count: message.attachments.size,
            });
            return;
        }

        let uploadedCount = 0;
        let skippedCount = 0;
        let totalBytes = 0;

        for (const attachment of message.attachments.values()) {
            if (!attachment.contentType?.startsWith("image/")) {
                skippedCount++;
                yield* Effect.logDebug("attachment skipped non_image=true", {
                    attachment_id: attachment.id,
                    content_type: attachment.contentType ?? "unknown",
                    attachment_url: attachment.url,
                });
                continue;
            }

            const [downloadDuration, imageBuffer] = yield* Effect.timed(
                storage.downloadImage(attachment.url),
            );

            yield* Effect.annotateCurrentSpan({
                attachment_id: attachment.id,
                download_size_bytes: imageBuffer.length,
                download_duration_ms: Duration.toMillis(downloadDuration),
            });

            const filename = `${crypto.randomUUID()}.jpg`;

            const [uploadDuration, s3Key] = yield* Effect.timed(
                storage.uploadImage(imageBuffer, eventSlug, filename),
            );

            const [updateDuration] = yield* Effect.timed(
                storage.updateEventIndex(eventSlug, {
                    filename,
                    uploadedAt: new Date().toISOString(),
                    discordMessageId: message.id,
                    discordUserId: message.author.id,
                }),
            );

            totalBytes += imageBuffer.length;
            uploadedCount++;

            yield* Effect.logInfo("photo uploaded", {
                filename,
                event_slug: eventSlug,
                message_id: message.id,
                user_id: message.author.id,
                channel_id: message.channelId,
                thread_id: message.channel.id,
                attachment_id: attachment.id,
                attachment_url: attachment.url,
                content_type: attachment.contentType,
                original_size_bytes: attachment.size,
                processed_size_bytes: imageBuffer.length,
                s3_key: s3Key,
                download_duration_ms: Duration.toMillis(downloadDuration),
                upload_duration_ms: Duration.toMillis(uploadDuration),
                index_update_duration_ms: Duration.toMillis(updateDuration),
            });
        }

        const totalDurationMs = Date.now() - startTime;

        yield* Effect.logInfo("hack night photos processed", {
            event_slug: eventSlug,
            message_id: message.id,
            channel_id: message.channelId,
            thread_id: message.channel.id,
            user_id: message.author.id,
            uploaded_count: uploadedCount,
            skipped_count: skippedCount,
            total_attachments: message.attachments.size,
            total_size_bytes: totalBytes,
            duration_ms: totalDurationMs,
        });

        yield* Effect.tryPromise({
            try: () => message.react("\u2705"),
            catch: (e) =>
                new Error(`Failed to react: ${e instanceof Error ? e.message : String(e)}`),
        }).pipe(
            Effect.catchAll((e) =>
                Effect.logWarning("reaction failed", {
                    reaction: "✅",
                    message_id: message.id,
                    error_message: e.message,
                }),
            ),
        );
    },
    (effect, message) =>
        effect.pipe(
            Effect.catchAll((e) =>
                Effect.logError("hack night image upload failed", {
                    ...structuredError(e),
                    message_id: message.id,
                    channel_id: message.channelId,
                    thread_id: message.channel.isThread() ? message.channel.id : undefined,
                    user_id: message.author.id,
                    attachment_count: message.attachments.size,
                    thread_name: message.channel.isThread() ? message.channel.name : undefined,
                }).pipe(
                    Effect.andThen(
                        Effect.tryPromise({
                            try: () => message.react("\u274C"),
                            catch: () => undefined,
                        }).pipe(Effect.ignore),
                    ),
                ),
            ),
        ),
    Effect.annotateLogs({ feature: "HackNight" }),
);

export const createHackNightThread = Effect.fn("HackNight.createThread")(
    function* (client: Client) {
        const startTime = Date.now();
        const channel = client.channels.cache.get(HACK_NIGHT_CHANNEL_ID);

        yield* Effect.annotateCurrentSpan({
            channel_id: HACK_NIGHT_CHANNEL_ID,
            ping_role_id: HACK_NIGHT_PING_ROLE_ID,
        });

        if (!channel) {
            yield* Effect.logWarning("channel not found", {
                channel_id: HACK_NIGHT_CHANNEL_ID,
                channel_name: "#hack-night",
                cache_size: client.channels.cache.size,
            });
            return;
        }

        if (!channel.isSendable()) {
            yield* Effect.logWarning("channel not sendable", {
                channel_id: HACK_NIGHT_CHANNEL_ID,
                channel_name: "#hack-night",
                channel_type: channel.type,
            });
            return;
        }

        const hackNightMessage = yield* randomItem(HACK_NIGHT_MESSAGES);
        const startContent =
            `${hackNightMessage} \u{1F389}` +
            `\n\nShare your pictures from the night in this thread!`;
        const pingContent = `(<@&${HACK_NIGHT_PING_ROLE_ID}>)`;

        const dateObj = new Date();
        const dateString = `${`${1 + dateObj.getMonth()}`.padStart(2, "0")}/${`${dateObj.getDate()}`.padStart(2, "0")}`;
        const threadName = `Hack Night Images - ${dateString}`;

        const [createDuration, result] = yield* Effect.timed(
            Effect.tryPromise({
                try: async () => {
                    const message = await channel.send({ content: startContent });
                    await message.pin();

                    const thread = await message.startThread({
                        name: threadName,
                        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
                    });

                    const pinnedMessage = await channel.messages.fetch({ limit: 1 });
                    const systemMessage = pinnedMessage.first();
                    if (systemMessage) {
                        await systemMessage.delete();
                    }

                    await thread.send({ content: pingContent });

                    return {
                        message_id: message.id,
                        thread_id: thread.id,
                        thread_name: thread.name,
                    };
                },
                catch: (e) =>
                    new Error(
                        `Failed to create hack night thread: ${e instanceof Error ? e.message : String(e)}`,
                    ),
            }),
        );

        const totalDurationMs = Date.now() - startTime;

        yield* Effect.logInfo("hack night thread created", {
            channel_id: HACK_NIGHT_CHANNEL_ID,
            thread_id: result.thread_id,
            thread_name: result.thread_name,
            message_id: result.message_id,
            ping_role_id: HACK_NIGHT_PING_ROLE_ID,
            date: dateString,
            create_duration_ms: Duration.toMillis(createDuration),
            duration_ms: totalDurationMs,
        });
    },
    (effect) =>
        effect.pipe(
            Effect.catchAll((e) =>
                Effect.logError("hack night thread creation failed", {
                    ...structuredError(e),
                    channel_id: HACK_NIGHT_CHANNEL_ID,
                    ping_role_id: HACK_NIGHT_PING_ROLE_ID,
                }),
            ),
        ),
    Effect.annotateLogs({ feature: "HackNight" }),
);

export const cleanupHackNightThread = Effect.fn("HackNight.cleanupThread")(
    function* (client: Client) {
        const startTime = Date.now();
        const storage = yield* Storage;

        const channel = client.channels.cache.get(HACK_NIGHT_CHANNEL_ID);

        yield* Effect.annotateCurrentSpan({
            channel_id: HACK_NIGHT_CHANNEL_ID,
            photography_award_role_id: HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID,
        });

        if (!channel) {
            yield* Effect.logWarning("channel not found for cleanup", {
                channel_id: HACK_NIGHT_CHANNEL_ID,
                channel_name: "#hack-night",
                cache_size: client.channels.cache.size,
            });
            return;
        }

        if (!channel.isSendable()) {
            yield* Effect.logWarning("channel not sendable for cleanup", {
                channel_id: HACK_NIGHT_CHANNEL_ID,
                channel_name: "#hack-night",
                channel_type: channel.type,
            });
            return;
        }

        if (channel.type !== ChannelType.GuildText) {
            yield* Effect.logWarning("channel wrong type for cleanup", {
                channel_id: HACK_NIGHT_CHANNEL_ID,
                channel_name: "#hack-night",
                channel_type: channel.type,
                expected_type: ChannelType.GuildText,
            });
            return;
        }

        const textChannel = channel as TextChannel;

        const [fetchDuration, threads] = yield* Effect.timed(
            Effect.tryPromise({
                try: () => textChannel.threads.fetchActive(),
                catch: (e) =>
                    new Error(
                        `Failed to fetch threads: ${e instanceof Error ? e.message : String(e)}`,
                    ),
            }),
        );

        yield* Effect.logDebug("active threads fetched", {
            channel_id: HACK_NIGHT_CHANNEL_ID,
            active_thread_count: threads.threads.size,
            duration_ms: Duration.toMillis(fetchDuration),
        });

        const hackNightImageThread = threads.threads
            .filter((t) => t.name.startsWith("Hack Night Images - "))
            .sorted((a, b) => {
                if (!a.createdTimestamp || !b.createdTimestamp) return 0;
                return b.createdTimestamp - a.createdTimestamp;
            })
            .first();

        if (!hackNightImageThread) {
            yield* Effect.logWarning("hack night thread not found", {
                channel_id: HACK_NIGHT_CHANNEL_ID,
                active_thread_count: threads.threads.size,
                searched_prefix: "Hack Night Images - ",
            });
            return;
        }

        yield* Effect.annotateCurrentSpan({
            thread_id: hackNightImageThread.id,
            thread_name: hackNightImageThread.name,
        });

        const eventSlug = yield* generateEventSlug(hackNightImageThread.createdAt!);
        const [indexFetchDuration, eventIndexOpt] = yield* Effect.timed(
            storage.getEventIndex(eventSlug),
        );

        yield* Effect.logDebug("event index fetched", {
            event_slug: eventSlug,
            has_index: Option.isSome(eventIndexOpt),
            image_count: Option.isSome(eventIndexOpt) ? eventIndexOpt.value.images.length : 0,
            duration_ms: Duration.toMillis(indexFetchDuration),
        });

        if (Option.isNone(eventIndexOpt) || eventIndexOpt.value.images.length === 0) {
            yield* Effect.logWarning("no images found for cleanup", {
                event_slug: eventSlug,
                thread_id: hackNightImageThread.id,
                thread_name: hackNightImageThread.name,
                has_index: Option.isSome(eventIndexOpt),
            });
            return;
        }

        const eventIndex = eventIndexOpt.value;
        const contributors = new Map<string, number>();

        for (const image of eventIndex.images) {
            const count = contributors.get(image.discordUserId) ?? 0;
            contributors.set(image.discordUserId, count + 1);
        }

        const topContributors = Array.from(contributors)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const [winner] = Array.from(contributors).sort((a, b) => b[1] - a[1]);

        yield* Effect.logDebug("contributor stats calculated", {
            event_slug: eventSlug,
            total_contributors: contributors.size,
            total_images: eventIndex.images.length,
            top_contributor_id: winner?.[0],
            top_contributor_count: winner?.[1],
            top_5_count: topContributors.length,
        });

        const [cleanupDuration, cleanupResult] = yield* Effect.timed(
            Effect.tryPromise({
                try: async () => {
                    const starterMessage = await hackNightImageThread.fetchStarterMessage();

                    if (starterMessage) {
                        await starterMessage.reply({
                            content: `Thanks for coming to Hack Night! We took ${eventIndex.images.length} picture${eventIndex.images.length === 1 ? "" : "s"} :D`,
                        });

                        await textChannel.send({
                            content: `Our top contributors this week are:\n${topContributors
                                .map(([id, count], index) => `\n#${index + 1}: <@${id}> - ${count}`)
                                .join("")}`,
                        });

                        await starterMessage.unpin();
                    }

                    await hackNightImageThread.setLocked(true);
                    await hackNightImageThread.setArchived(true);

                    const roleHolder = await textChannel.guild.roles
                        .fetch(HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID)
                        .then((r) => r?.members);

                    const previousHoldersCount = roleHolder?.size ?? 0;
                    if (roleHolder) {
                        for (const member of roleHolder.values()) {
                            await member.roles.remove(HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID);
                        }
                    }

                    let winnerAssigned = false;
                    if (winner) {
                        const winnerMember = await textChannel.guild.members.fetch(winner[0]);
                        await winnerMember.roles.add(HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID);
                        winnerAssigned = true;

                        await textChannel.send({
                            content: `Congratulations to <@${winner[0]}> for winning the Hack Night Photography Award! :D`,
                        });
                    }

                    await textChannel.send({
                        content: "Happy hacking, and see you next time! :D",
                    });

                    return {
                        previous_role_holders: previousHoldersCount,
                        winner_assigned: winnerAssigned,
                        messages_sent: starterMessage ? 4 : 1,
                    };
                },
                catch: (e) =>
                    new Error(
                        `Failed to cleanup hack night thread: ${e instanceof Error ? e.message : String(e)}`,
                    ),
            }),
        );

        const totalDurationMs = Date.now() - startTime;

        yield* Effect.logInfo("hack night thread cleaned up", {
            channel_id: HACK_NIGHT_CHANNEL_ID,
            thread_id: hackNightImageThread.id,
            thread_name: hackNightImageThread.name,
            event_slug: eventSlug,
            image_count: eventIndex.images.length,
            contributor_count: contributors.size,
            top_contributor_id: winner?.[0],
            top_contributor_photo_count: winner?.[1],
            previous_role_holders: cleanupResult.previous_role_holders,
            winner_assigned: cleanupResult.winner_assigned,
            messages_sent: cleanupResult.messages_sent,
            photography_award_role_id: HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID,
            thread_locked: true,
            thread_archived: true,
            cleanup_duration_ms: Duration.toMillis(cleanupDuration),
            duration_ms: totalDurationMs,
        });
    },
    (effect) =>
        effect.pipe(
            Effect.catchAll((e) =>
                Effect.logError("hack night thread cleanup failed", {
                    ...structuredError(e),
                    channel_id: HACK_NIGHT_CHANNEL_ID,
                    photography_award_role_id: HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID,
                }),
            ),
        ),
    Effect.annotateLogs({ feature: "HackNight" }),
);

export const hackNightCreateSchedule = Schedule.cron("0 20 * * 5");

export const hackNightCleanupSchedule = Schedule.cron("0 18 * * 0");

const HACK_NIGHT_DEFAULT_EMOJI = "\u{1F319}";

const TAILWIND_COLORS = [
    "slate",
    "gray",
    "zinc",
    "neutral",
    "stone",
    "red",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
] as const;

export const initHnCommand = new SlashCommandBuilder()
    .setName("init-hn")
    .setDescription("Initialize hack night settings")
    .addStringOption((option) =>
        option
            .setName("emoji")
            .setDescription("The emoji to use as the channel prefix")
            .setRequired(true),
    )
    .addStringOption((option) =>
        option
            .setName("version")
            .setDescription("The semver version string (e.g. 6.17)")
            .setRequired(true),
    )
    .addStringOption((option) =>
        option
            .setName("tagline")
            .setDescription("A short tagline (<30 chars)")
            .setRequired(true),
    )
    .addStringOption((option) =>
        option
            .setName("color")
            .setDescription("A Tailwind color from the palette")
            .setRequired(true)
            .addChoices(
                ...TAILWIND_COLORS.map((color) => ({
                    name: color,
                    value: color,
                })),
            ),
    );

export const resetHnCommand = new SlashCommandBuilder()
    .setName("reset-hn")
    .setDescription("Reset the hack night channel prefix to the moon emoji");

const stripLeadingEmoji = (name: string): string => {
    return name.replace(/^\p{Extended_Pictographic}/u, "");
};

const updateEdgeConfig = Effect.fn("HackNight.updateEdgeConfig")(
    function* (version: string, tagline: string, color: string) {
        const startTime = Date.now();
        const config = yield* AppConfig;
        const apiToken = Redacted.value(config.VERCEL_API_TOKEN);
        const edgeConfigId = config.VERCEL_EDGE_CONFIG_ID;

        yield* Effect.annotateCurrentSpan({
            edge_config_id: edgeConfigId,
            version,
            tagline,
            color,
        });

        const vercel = new Vercel({ bearerToken: apiToken });

        yield* Effect.tryPromise({
            try: () =>
                vercel.edgeConfig.patchEdgeConfigItems({
                    edgeConfigId,
                    requestBody: {
                        items: [
                            { operation: "upsert", key: "dashboard_version", value: version },
                            { operation: "upsert", key: "dashboard_tagline", value: tagline },
                            { operation: "upsert", key: "dashboard_color", value: color },
                        ],
                    },
                }),
            catch: (cause) =>
                new Error(
                    `Failed to update edge config: ${cause instanceof Error ? cause.message : String(cause)}`,
                ),
        });

        yield* Effect.logInfo("edge config updated", {
            edge_config_id: edgeConfigId,
            version,
            tagline,
            color,
            duration_ms: Date.now() - startTime,
        });
    },
    Effect.annotateLogs({ feature: "HackNight" }),
);

export const handleInitHnCommand = Effect.fn("HackNight.handleInitHn")(
    function* (interaction: ChatInputCommandInteraction) {
        const startTime = Date.now();

        const memberRoles =
            interaction.member && "cache" in interaction.member.roles
                ? interaction.member.roles.cache
                : null;
        const isOrganizer = memberRoles?.has(ORGANIZER_ROLE_ID) ?? false;

        if (!isOrganizer) {
            yield* Effect.tryPromise({
                try: () =>
                    interaction.reply({
                        content: "Only organizers can run this command.",
                        flags: MessageFlags.Ephemeral,
                    }),
                catch: () => undefined,
            });
            return;
        }

        const emoji = interaction.options.getString("emoji", true);
        const version = interaction.options.getString("version", true);
        const tagline = interaction.options.getString("tagline", true);
        const color = interaction.options.getString("color", true);

        yield* Effect.annotateCurrentSpan({
            user_id: interaction.user.id,
            emoji,
            version,
            tagline,
            color,
        });

        if (tagline.length >= 30) {
            yield* Effect.tryPromise({
                try: () =>
                    interaction.reply({
                        content: "Tagline must be less than 30 characters.",
                        flags: MessageFlags.Ephemeral,
                    }),
                catch: () => undefined,
            });
            return;
        }

        yield* Effect.tryPromise({
            try: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }),
            catch: (cause) =>
                new Error(
                    `Failed to defer reply: ${cause instanceof Error ? cause.message : String(cause)}`,
                ),
        });

        const channel = yield* Effect.tryPromise({
            try: () => interaction.client.channels.fetch(HACK_NIGHT_CHANNEL_ID),
            catch: (e) =>
                new Error(
                    `Failed to fetch channel: ${e instanceof Error ? e.message : String(e)}`,
                ),
        });

        if (!channel || !channel.isSendable()) {
            yield* Effect.tryPromise({
                try: () =>
                    interaction.editReply({
                        content: "Could not find the hack night channel.",
                    }),
                catch: () => undefined,
            });
            return;
        }

        const textChannel = channel as TextChannel;
        const currentName = textChannel.name;
        const strippedName = stripLeadingEmoji(currentName);
        const newName = `${emoji}${strippedName}`;

        yield* Effect.tryPromise({
            try: () => textChannel.setName(newName),
            catch: (cause) =>
                new Error(
                    `Failed to update channel name: ${cause instanceof Error ? cause.message : String(cause)}`,
                ),
        });

        yield* updateEdgeConfig(version, tagline, color);

        yield* Effect.tryPromise({
            try: () =>
                interaction.editReply({
                    content: `Hack night initialized!\n- Channel: ${newName}\n- Version: ${version}\n- Tagline: ${tagline}\n- Color: ${color}`,
                }),
            catch: () => undefined,
        });

        yield* Effect.logInfo("hack night initialized", {
            user_id: interaction.user.id,
            emoji,
            version,
            tagline,
            color,
            previous_channel_name: currentName,
            new_channel_name: newName,
            duration_ms: Date.now() - startTime,
        });
    },
    Effect.annotateLogs({ feature: "HackNight" }),
);

export const handleResetHnCommand = Effect.fn("HackNight.handleResetHn")(
    function* (interaction: ChatInputCommandInteraction) {
        const startTime = Date.now();

        const memberRoles =
            interaction.member && "cache" in interaction.member.roles
                ? interaction.member.roles.cache
                : null;
        const isOrganizer = memberRoles?.has(ORGANIZER_ROLE_ID) ?? false;

        if (!isOrganizer) {
            yield* Effect.tryPromise({
                try: () =>
                    interaction.reply({
                        content: "Only organizers can run this command.",
                        flags: MessageFlags.Ephemeral,
                    }),
                catch: () => undefined,
            });
            return;
        }

        yield* Effect.annotateCurrentSpan({
            user_id: interaction.user.id,
        });

        yield* Effect.tryPromise({
            try: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }),
            catch: (cause) =>
                new Error(
                    `Failed to defer reply: ${cause instanceof Error ? cause.message : String(cause)}`,
                ),
        });

        const channel = yield* Effect.tryPromise({
            try: () => interaction.client.channels.fetch(HACK_NIGHT_CHANNEL_ID),
            catch: (e) =>
                new Error(
                    `Failed to fetch channel: ${e instanceof Error ? e.message : String(e)}`,
                ),
        });

        if (!channel || !channel.isSendable()) {
            yield* Effect.tryPromise({
                try: () =>
                    interaction.editReply({
                        content: "Could not find the hack night channel.",
                    }),
                catch: () => undefined,
            });
            return;
        }

        const textChannel = channel as TextChannel;
        const currentName = textChannel.name;
        const strippedName = stripLeadingEmoji(currentName);
        const newName = `${HACK_NIGHT_DEFAULT_EMOJI}${strippedName}`;

        yield* Effect.tryPromise({
            try: () => textChannel.setName(newName),
            catch: (cause) =>
                new Error(
                    `Failed to update channel name: ${cause instanceof Error ? cause.message : String(cause)}`,
                ),
        });

        yield* Effect.tryPromise({
            try: () =>
                interaction.editReply({
                    content: `Hack night channel reset to ${newName}.`,
                }),
            catch: () => undefined,
        });

        yield* Effect.logInfo("hack night channel reset", {
            user_id: interaction.user.id,
            previous_channel_name: currentName,
            new_channel_name: newName,
            duration_ms: Date.now() - startTime,
        });
    },
    Effect.annotateLogs({ feature: "HackNight" }),
);
