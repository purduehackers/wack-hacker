import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Duration, Effect, Option, Redacted } from "effect";
import sharp from "sharp";

import { AppConfig } from "../config";
import { StorageError } from "../errors";

export interface ImageMetadata {
    filename: string;
    uploadedAt: string;
    discordMessageId: string;
    discordUserId: string;
}

export interface EventIndex {
    eventSlug: string;
    lastUpdated: string;
    images: ImageMetadata[];
}

export class Storage extends Effect.Service<Storage>()("Storage", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;

        const s3 = new S3Client({
            region: "auto",
            endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: Redacted.value(config.R2_ACCESS_KEY_ID),
                secretAccessKey: Redacted.value(config.R2_SECRET_ACCESS_KEY),
            },
        });

        const bucket = config.R2_BUCKET_NAME;

        const generateEventSlug = (date: Date): string => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            return `hack-night-${year}-${month}-${day}`;
        };

        const getEventIndex = Effect.fn("Storage.getEventIndex")(function* (eventSlug: string) {
            const key = `images/${eventSlug}/index.json`;

            yield* Effect.annotateCurrentSpan({ event_slug: eventSlug, key });

            yield* Effect.logDebug("storage download initiated", {
                service_name: "Storage",
                method: "getEventIndex",
                operation_type: "download",
                event_slug: eventSlug,
                key,
                bucket: bucket,
            });

            const [duration, response] = yield* Effect.tryPromise({
                try: async () => {
                    try {
                        return await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
                    } catch (e) {
                        if ((e as { name?: string })?.name === "NoSuchKey") {
                            return null;
                        }
                        throw e;
                    }
                },
                catch: (e) => new StorageError({ operation: "getEventIndex", key, cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            if (!response || !response.Body) {
                yield* Effect.logDebug("storage index not found", {
                    service_name: "Storage",
                    method: "getEventIndex",
                    operation_type: "download",
                    event_slug: eventSlug,
                    key,
                    found: false,
                    duration_ms,
                    latency_ms: duration_ms,
                });

                return Option.none<EventIndex>();
            }

            const bodyString = yield* Effect.tryPromise({
                try: () => response.Body!.transformToString(),
                catch: (e) =>
                    new StorageError({
                        operation: "getEventIndex.parse",
                        key,
                        cause: e,
                    }),
            });

            const index = JSON.parse(bodyString) as EventIndex;

            yield* Effect.annotateCurrentSpan({
                duration_ms,
                image_count: index.images.length,
                content_size_bytes: bodyString.length,
            });

            yield* Effect.logInfo("storage download completed", {
                service_name: "Storage",
                method: "getEventIndex",
                operation_type: "download",
                event_slug: eventSlug,
                key,
                bucket: bucket,
                found: true,
                image_count: index.images.length,
                content_size_bytes: bodyString.length,
                duration_ms,
                latency_ms: duration_ms,
            });

            return Option.some(index);
        });

        const uploadImage = Effect.fn("Storage.uploadImage")(function* (
            imageBuffer: Buffer,
            eventSlug: string,
            filename: string,
        ) {
            const originalSize = imageBuffer.length;

            yield* Effect.annotateCurrentSpan({
                event_slug: eventSlug,
                filename,
                original_size_bytes: originalSize,
            });

            yield* Effect.logDebug("image processing initiated", {
                service_name: "Storage",
                method: "uploadImage",
                operation_type: "image_processing",
                event_slug: eventSlug,
                filename,
                original_size_bytes: originalSize,
            });

            const processedBuffer = yield* Effect.tryPromise({
                try: () => sharp(imageBuffer).jpeg().toBuffer(),
                catch: (e) => new StorageError({ operation: "processImage", cause: e }),
            });

            const processedSize = processedBuffer.length;
            const key = `images/${eventSlug}/${filename}`;

            yield* Effect.logDebug("storage upload initiated", {
                service_name: "Storage",
                method: "uploadImage",
                operation_type: "upload",
                event_slug: eventSlug,
                filename,
                key,
                bucket: bucket,
                original_size_bytes: originalSize,
                processed_size_bytes: processedSize,
                compression_ratio: originalSize > 0 ? processedSize / originalSize : 0,
            });

            const [duration] = yield* Effect.tryPromise({
                try: () =>
                    s3.send(
                        new PutObjectCommand({
                            Bucket: bucket,
                            Key: key,
                            Body: processedBuffer,
                            ContentType: "image/jpeg",
                        }),
                    ),
                catch: (e) => new StorageError({ operation: "uploadImage", key, cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            yield* Effect.annotateCurrentSpan({
                duration_ms,
                processed_size_bytes: processedSize,
            });

            yield* Effect.logInfo("storage upload completed", {
                service_name: "Storage",
                method: "uploadImage",
                operation_type: "upload",
                event_slug: eventSlug,
                filename,
                key,
                bucket: bucket,
                original_size_bytes: originalSize,
                processed_size_bytes: processedSize,
                compression_ratio: originalSize > 0 ? processedSize / originalSize : 0,
                duration_ms,
                latency_ms: duration_ms,
            });

            return key;
        });

        const updateEventIndex = Effect.fn("Storage.updateEventIndex")(function* (
            eventSlug: string,
            newImage: ImageMetadata,
        ) {
            yield* Effect.annotateCurrentSpan({ event_slug: eventSlug });

            yield* Effect.logDebug("updating event index", {
                service_name: "Storage",
                method: "updateEventIndex",
                operation_type: "update_index",
                event_slug: eventSlug,
                new_image_filename: newImage.filename,
            });

            const existingOpt = yield* getEventIndex(eventSlug);
            const existing = Option.getOrElse(existingOpt, () => ({
                eventSlug,
                lastUpdated: new Date().toISOString(),
                images: [] as ImageMetadata[],
            }));

            const previousImageCount = existing.images.length;
            existing.images.push(newImage);
            existing.lastUpdated = new Date().toISOString();

            const key = `images/${eventSlug}/index.json`;
            const indexJson = JSON.stringify(existing, null, 2);

            yield* Effect.logDebug("storage upload initiated", {
                service_name: "Storage",
                method: "updateEventIndex",
                operation_type: "upload",
                event_slug: eventSlug,
                key,
                bucket: bucket,
                previous_image_count: previousImageCount,
                new_image_count: existing.images.length,
                content_size_bytes: indexJson.length,
            });

            const [duration] = yield* Effect.tryPromise({
                try: () =>
                    s3.send(
                        new PutObjectCommand({
                            Bucket: bucket,
                            Key: key,
                            Body: indexJson,
                            ContentType: "application/json",
                        }),
                    ),
                catch: (e) =>
                    new StorageError({
                        operation: "updateEventIndex",
                        key,
                        cause: e,
                    }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            yield* Effect.annotateCurrentSpan({
                duration_ms,
                image_count: existing.images.length,
            });

            yield* Effect.logInfo("event index updated", {
                service_name: "Storage",
                method: "updateEventIndex",
                operation_type: "upload",
                event_slug: eventSlug,
                key,
                bucket: bucket,
                previous_image_count: previousImageCount,
                new_image_count: existing.images.length,
                content_size_bytes: indexJson.length,
                duration_ms,
                latency_ms: duration_ms,
            });
        });

        const isImageUploaded = Effect.fn("Storage.isImageUploaded")(function* (
            eventSlug: string,
            discordMessageId: string,
        ) {
            yield* Effect.annotateCurrentSpan({
                event_slug: eventSlug,
                discord_message_id: discordMessageId,
            });

            yield* Effect.logDebug("checking image upload status", {
                service_name: "Storage",
                method: "isImageUploaded",
                operation_type: "check_exists",
                event_slug: eventSlug,
                discord_message_id: discordMessageId,
            });

            const indexOpt = yield* getEventIndex(eventSlug);

            if (Option.isNone(indexOpt)) {
                yield* Effect.logDebug("image upload check completed", {
                    service_name: "Storage",
                    method: "isImageUploaded",
                    operation_type: "check_exists",
                    event_slug: eventSlug,
                    discord_message_id: discordMessageId,
                    found: false,
                    reason: "index_not_found",
                });
                return false;
            }

            const found = indexOpt.value.images.some(
                (img) => img.discordMessageId === discordMessageId,
            );

            yield* Effect.annotateCurrentSpan({ found });

            yield* Effect.logDebug("image upload check completed", {
                service_name: "Storage",
                method: "isImageUploaded",
                operation_type: "check_exists",
                event_slug: eventSlug,
                discord_message_id: discordMessageId,
                found,
                total_images: indexOpt.value.images.length,
            });

            return found;
        });

        const downloadImage = Effect.fn("Storage.downloadImage")(function* (url: string) {
            yield* Effect.annotateCurrentSpan({ url });

            yield* Effect.logDebug("image download initiated", {
                service_name: "Storage",
                method: "downloadImage",
                operation_type: "download",
                url,
            });

            const [duration, response] = yield* Effect.tryPromise({
                try: () => fetch(url),
                catch: (e) => new StorageError({ operation: "downloadImage", cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            if (!response.ok) {
                yield* Effect.logError("image download failed", {
                    service_name: "Storage",
                    method: "downloadImage",
                    operation_type: "download",
                    url,
                    http_status: response.status,
                    error_message: response.statusText,
                    duration_ms,
                    latency_ms: duration_ms,
                });

                return yield* Effect.fail(
                    new StorageError({
                        operation: "downloadImage",
                        cause: new Error(`Failed to download: ${response.statusText}`),
                    }),
                );
            }

            const buffer = yield* Effect.tryPromise({
                try: async () => Buffer.from(await response.arrayBuffer()),
                catch: (e) => new StorageError({ operation: "downloadImage", cause: e }),
            });

            yield* Effect.annotateCurrentSpan({
                duration_ms,
                size_bytes: buffer.length,
            });

            yield* Effect.logInfo("image download completed", {
                service_name: "Storage",
                method: "downloadImage",
                operation_type: "download",
                url,
                http_status: response.status,
                size_bytes: buffer.length,
                duration_ms,
                latency_ms: duration_ms,
            });

            return buffer;
        });

        return {
            generateEventSlug,
            uploadImage,
            getEventIndex,
            updateEventIndex,
            isImageUploaded,
            downloadImage,
        } as const;
    }).pipe(Effect.annotateLogs({ service: "Storage" })),
}) {}

/** @deprecated Use Storage.Default instead */
export const StorageLive = Storage.Default;
