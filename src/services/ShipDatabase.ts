import { createClient } from "@libsql/client";
import { Duration, Effect, Redacted } from "effect";

import { AppConfig } from "../config";
import { DatabaseError } from "../errors";

interface ShipRow {
    id: string;
    user_id: string;
    username: string;
    avatar_url: string | null;
    message_id: string | null;
    title: string | null;
    content: string | null;
    attachments: string;
    shipped_at: string;
}

export class ShipDatabase extends Effect.Service<ShipDatabase>()("ShipDatabase", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;

        const client = createClient({
            url: config.SHIP_DATABASE_URL,
            authToken: Redacted.value(config.SHIP_DATABASE_AUTH_TOKEN),
        });

        yield* Effect.logInfo("ship database service initialized", {
            service_name: "ShipDatabase",
            url: config.SHIP_DATABASE_URL,
        });

        const insertShip = Effect.fn("ShipDatabase.insertShip")(function* (data: {
            userId: string;
            username: string;
            avatarUrl: string | null;
            messageId: string;
            title: string | null;
            content: string;
            attachments: Array<{ key: string; type: string; filename: string }>;
        }) {
            const id = crypto.randomUUID();
            const shippedAt = new Date().toISOString();
            const attachmentsJson = JSON.stringify(data.attachments);

            yield* Effect.annotateCurrentSpan({
                ship_id: id,
                user_id: data.userId,
                message_id: data.messageId,
            });

            yield* Effect.logDebug("ship insert initiated", {
                service_name: "ShipDatabase",
                method: "insertShip",
                ship_id: id,
                user_id: data.userId,
                message_id: data.messageId,
                attachment_count: data.attachments.length,
            });

            const [duration] = yield* Effect.tryPromise({
                try: () =>
                    client.execute({
                        sql: `INSERT INTO ship (id, user_id, username, avatar_url, message_id, title, content, attachments, shipped_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        args: [
                            id,
                            data.userId,
                            data.username,
                            data.avatarUrl,
                            data.messageId,
                            data.title,
                            data.content,
                            attachmentsJson,
                            shippedAt,
                        ],
                    }),
                catch: (e) => new DatabaseError({ operation: "ShipDatabase.insertShip", cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            yield* Effect.logInfo("ship inserted", {
                service_name: "ShipDatabase",
                method: "insertShip",
                ship_id: id,
                user_id: data.userId,
                message_id: data.messageId,
                duration_ms,
            });

            return id;
        });

        const deleteByMessageId = Effect.fn("ShipDatabase.deleteByMessageId")(function* (
            messageId: string,
        ) {
            yield* Effect.annotateCurrentSpan({ message_id: messageId });

            const [duration] = yield* Effect.tryPromise({
                try: () =>
                    client.execute({
                        sql: `DELETE FROM ship WHERE message_id = ?`,
                        args: [messageId],
                    }),
                catch: (e) =>
                    new DatabaseError({ operation: "ShipDatabase.deleteByMessageId", cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            yield* Effect.logInfo("ship deleted by message id", {
                service_name: "ShipDatabase",
                method: "deleteByMessageId",
                message_id: messageId,
                duration_ms,
            });
        });

        return { insertShip, deleteByMessageId } as const;
    }).pipe(Effect.annotateLogs({ service: "ShipDatabase" })),
}) {}
