import { type ChatInputCommandInteraction, type Message, SlashCommandBuilder } from "discord.js";

import { Effect, Match } from "effect";

import { AppConfig } from "../../config";
import { ORGANIZER_ROLE_ID, SHIP_CHANNEL_ID } from "../../constants";
import { containsUrl, replyEphemeral } from "../../lib/discord";
import { ShipDatabase } from "../../services/ShipDatabase";
import { Storage } from "../../services";

export const deleteShipCommand = new SlashCommandBuilder()
    .setName("delete-ship")
    .setDescription("Delete a ship from the gallery website")
    .addStringOption((option) =>
        option
            .setName("message_id")
            .setDescription("The Discord message ID of the ship to delete")
            .setRequired(true),
    );

export const handleDeleteShipCommand = Effect.fn("ShipScraper.handleDeleteCommand")(
    function* (interaction: ChatInputCommandInteraction) {
        const startTime = Date.now();
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        const isOrganizer = member?.roles.cache.has(ORGANIZER_ROLE_ID) ?? false;

        if (!isOrganizer) {
            yield* replyEphemeral(interaction, "You must be an organizer to use this command.");
            return;
        }

        const messageId = interaction.options.getString("message_id", true);

        yield* Effect.annotateCurrentSpan({
            user_id: interaction.user.id,
            message_id: messageId,
        });

        const shipDb = yield* ShipDatabase;
        yield* shipDb.deleteByMessageId(messageId);

        yield* replyEphemeral(
            interaction,
            `Ship with message ID \`${messageId}\` has been deleted from the gallery.`,
        );

        yield* Effect.logInfo("ship deleted via command", {
            user_id: interaction.user.id,
            message_id: messageId,
            duration_ms: Date.now() - startTime,
        });
    },
    Effect.annotateLogs({ feature: "ShipScraper" }),
);

export const handleShipScraper = Effect.fn("ShipScraper.handle")(
    function* (message: Message) {
        const startTime = Date.now();

        if (message.author.bot) {
            yield* Effect.logDebug("message skipped", {
                reason: "bot_author",
                message_id: message.id,
            });
            return;
        }
        if (message.channelId !== SHIP_CHANNEL_ID) {
            yield* Effect.logDebug("message skipped", {
                reason: "wrong_channel",
                message_id: message.id,
                channel_id: message.channelId,
            });
            return;
        }

        yield* Effect.logDebug("ship message detected", {
            message_id: message.id,
            user_id: message.author.id,
            username: message.author.username,
            attachment_count: message.attachments.size,
        });

        // Validate: must have a URL or attachment (including forwarded snapshots)
        let hasUrl = yield* containsUrl(message.content);
        let hasAttachment = message.attachments.size > 0;

        for (const [, snapshot] of message.messageSnapshots) {
            if (!hasUrl && snapshot.content) {
                hasUrl = yield* containsUrl(snapshot.content);
            }
            if (!hasAttachment && snapshot.attachments.size > 0) {
                hasAttachment = true;
            }
        }

        if (!hasUrl && !hasAttachment) {
            yield* Effect.logDebug("ship message skipped, no url or attachment", {
                message_id: message.id,
                user_id: message.author.id,
            });
            return;
        }

        const config = yield* AppConfig;
        const storage = yield* Storage;
        const shipDb = yield* ShipDatabase;

        // Collect content from the message and any forwarded snapshots
        let content = message.content;
        const allAttachments = [...message.attachments.values()];

        for (const [, snapshot] of message.messageSnapshots) {
            if (snapshot.content) {
                content = content ? `${content}\n${snapshot.content}` : snapshot.content;
            }
            for (const [, attachment] of snapshot.attachments) {
                allAttachments.push(attachment);
            }
        }

        // Upload image attachments to R2, store keys
        const uploadedAttachments: Array<{ key: string; type: string; filename: string; width?: number; height?: number }> = [];

        for (const attachment of allAttachments) {
            const ct = attachment.contentType ?? "";
            const isMedia = ct.startsWith("image/") || ct.startsWith("video/");
            if (!isMedia) continue;

            const buffer = yield* storage.downloadMedia(attachment.url);
            const defaultName = ct.startsWith("video/") ? "video.mp4" : "image.jpg";
            const filename = `${message.id}-${attachment.name ?? defaultName}`;

            const key = yield* Match.value(ct).pipe(
                Match.when(
                    (ct) => ct.startsWith("image/"),
                    () =>
                        storage.uploadImage(buffer, "ships", filename, {
                            bucket: config.SHIP_R2_BUCKET_NAME,
                        }),
                ),
                Match.orElse(() =>
                    storage.uploadRaw(buffer, "ships", filename, ct, {
                        bucket: config.SHIP_R2_BUCKET_NAME,
                    }),
                ),
            );

            uploadedAttachments.push({
                key,
                type: ct || "application/octet-stream",
                filename: attachment.name ?? defaultName,
                width: attachment.width ?? undefined,
                height: attachment.height ?? undefined,
            });
        }

        const avatarUrl = message.author.displayAvatarURL({ size: 128, extension: "png" });
        const username =
            message.member?.displayName ?? message.author.displayName ?? message.author.username;

        const shipId = yield* shipDb.insertShip({
            userId: message.author.id,
            username,
            avatarUrl,
            messageId: message.id,
            title: null,
            content,
            attachments: uploadedAttachments,
        });

        yield* Effect.logInfo("ship scraped and stored", {
            ship_id: shipId,
            message_id: message.id,
            user_id: message.author.id,
            attachment_count: uploadedAttachments.length,
            uploaded_keys: uploadedAttachments.map((a) => a.key).join(","),
            duration_ms: Date.now() - startTime,
        });
    },
    Effect.annotateLogs({ feature: "ShipScraper" }),
);
