import { Duration, Effect, Redacted } from "effect";

import { AppConfig } from "../config";
import { DatabaseError } from "../errors";

export class ShipDatabase extends Effect.Service<ShipDatabase>()("ShipDatabase", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;

        const apiUrl = config.SHIP_API_URL;
        const apiKey = Redacted.value(config.SHIP_API_KEY);

        yield* Effect.logInfo("ship database service initialized", {
            service_name: "ShipDatabase",
            url: apiUrl,
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
            yield* Effect.annotateCurrentSpan({
                user_id: data.userId,
                message_id: data.messageId,
            });

            yield* Effect.logDebug("ship insert initiated", {
                service_name: "ShipDatabase",
                method: "insertShip",
                user_id: data.userId,
                message_id: data.messageId,
                attachment_count: data.attachments.length,
            });

            const [duration, response] = yield* Effect.tryPromise({
                try: async () => {
                    const res = await fetch(`${apiUrl}/api/ships`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${apiKey}`,
                        },
                        body: JSON.stringify(data),
                    });
                    if (!res.ok) {
                        throw new Error(`Ship API returned ${res.status}: ${await res.text()}`);
                    }
                    return (await res.json()) as { ok: boolean; id: string };
                },
                catch: (e) => new DatabaseError({ operation: "ShipDatabase.insertShip", cause: e }),
            }).pipe(Effect.timed);

            const id = response.id;
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

            const [duration, deletedShipId] = yield* Effect.tryPromise({
                try: async () => {
                    const res = await fetch(`${apiUrl}/api/ships/${messageId}`, {
                        method: "DELETE",
                        headers: {
                            Authorization: `Bearer ${apiKey}`,
                        },
                    });
                    if (!res.ok) {
                        throw new Error(`Ship API returned ${res.status}: ${await res.text()}`);
                    }
                    const { id } = (await res.json()) as { ok: true; id: string };
                    return id;
                },
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

            return deletedShipId;
        });

        return { insertShip, deleteByMessageId } as const;
    }).pipe(Effect.annotateLogs({ service: "ShipDatabase" })),
}) {}
