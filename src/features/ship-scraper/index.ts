import type { Message } from "discord.js";

import { Effect } from "effect";

import { AppConfig } from "../../config";
import { SHIP_CHANNEL_ID } from "../../constants";
import { containsUrl } from "../../lib/discord";
import { ShipDatabase } from "../../services/ShipDatabase";
import { Storage } from "../../services";

export const handleShipScraper = Effect.fn("ShipScraper.handle")(
    function* (message: Message) {
        if (message.author.bot) return;
        if (message.channelId !== SHIP_CHANNEL_ID) return;

        yield* Effect.logInfo("ship message detected", {
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
        const uploadedAttachments: Array<{ key: string; type: string; filename: string }> = [];

        for (const attachment of allAttachments) {
            const isImage = attachment.contentType?.startsWith("image/");
            if (!isImage) continue;

            const buffer = yield* storage.downloadImage(attachment.url);
            const filename = `${message.id}-${attachment.name ?? "image.jpg"}`;
            const key = yield* storage.uploadImage(buffer, "ships", filename, {
                bucket: config.SHIP_R2_BUCKET_NAME,
            });

            uploadedAttachments.push({
                key,
                type: attachment.contentType ?? "image/jpeg",
                filename: attachment.name ?? "image.jpg",
            });

            yield* Effect.logInfo("ship attachment uploaded to r2", {
                message_id: message.id,
                key,
                filename: attachment.name,
            });
        }

        // Title from first line
        const firstLine = content.split("\n")[0]?.trim() ?? "";
        const title = firstLine.length > 100 ? firstLine.slice(0, 100) + "..." : firstLine || null;

        const avatarUrl = message.author.displayAvatarURL({ size: 128, extension: "png" });

        const shipId = yield* shipDb.insertShip({
            userId: message.author.id,
            username: message.author.displayName ?? message.author.username,
            avatarUrl,
            messageId: message.id,
            title,
            content,
            attachments: uploadedAttachments,
        });

        yield* Effect.logInfo("ship scraped and stored", {
            ship_id: shipId,
            message_id: message.id,
            user_id: message.author.id,
            attachment_count: uploadedAttachments.length,
        });
    },
    Effect.annotateLogs({ feature: "ShipScraper" }),
);
