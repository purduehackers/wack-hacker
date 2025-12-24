import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { Duration, Effect, Option, Redacted } from "effect";

import { AppConfig } from "../config";
import * as schema from "../db/schema";
import { DatabaseError } from "../errors";

interface D1QueryResult<T> {
    results: T[];
    success: boolean;
    meta: { changes: number; last_row_id: number };
}

interface D1ApiResponse<T> {
    result: D1QueryResult<T>[];
    success: boolean;
    errors: { code: number; message: string }[];
}

// HACK: Drizzle's sqlite-proxy creates Proxy objects that intercept Object.keys() but return
// undefined for actual property access. When the D1 driver returns rows like:
//   { user_id: "123", thread_id: "456", created_at: "2025-01-01" }
// Drizzle transforms them into Proxy objects where:
//   - Object.keys(row) returns ["user_id", "thread_id", "created_at"]
//   - JSON.stringify(row) returns "{}"
//   - row.thread_id returns undefined
// Even spreading ({ ...row }) or JSON round-tripping doesn't fix this because the Proxy's
// getters return undefined. The workaround is to bypass Drizzle entirely for queries that
// need actual values, using rawQuery() which returns plain objects directly from D1.

const createD1Driver = (
    accountId: string,
    databaseId: string,
    apiToken: string,
    onQueryComplete?: (durationMs: number, rowCount: number) => void,
) => {
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;

    const executeQuery = async (
        sqlQuery: string,
        params: unknown[],
        method: "all" | "run" | "get" | "values",
    ): Promise<{ rows: Record<string, unknown>[] }> => {
        const startTime = Date.now();

        const response = await fetch(`${baseUrl}/query`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ sql: sqlQuery, params }),
        });

        const durationMs = Date.now() - startTime;

        if (!response.ok) {
            const text = await response.text();
            throw new DatabaseError({
                operation: "d1Query",
                cause: new Error(
                    `D1 API error: ${response.status} ${text} duration_ms=${durationMs}`,
                ),
            });
        }

        const data = (await response.json()) as D1ApiResponse<Record<string, unknown>>;

        if (!data.success) {
            throw new DatabaseError({
                operation: "d1Query",
                cause: new Error(
                    `D1 query error: ${data.errors.map((e) => e.message).join(", ")} duration_ms=${durationMs}`,
                ),
            });
        }

        const result = data.result[0];
        const rows = method === "all" ? result.results : result.results.slice(0, 1);

        onQueryComplete?.(durationMs, rows.length);

        return { rows };
    };

    return {
        drizzleDriver: executeQuery,
        rawQuery: async <T extends Record<string, unknown>>(
            sql: string,
            params: unknown[] = [],
        ): Promise<T[]> => {
            const { rows } = await executeQuery(sql, params, "all");
            return rows as T[];
        },
    };
};

export class Database extends Effect.Service<Database>()("Database", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;

        yield* Effect.logInfo("database service initializing", {
            service_name: "Database",
            operation_type: "initialization",
            account_id: config.D1_ACCOUNT_ID,
            database_id: config.D1_DATABASE_ID,
        });

        const d1Driver = createD1Driver(
            config.D1_ACCOUNT_ID,
            config.D1_DATABASE_ID,
            Redacted.value(config.D1_API_TOKEN),
        );

        const db = drizzle<typeof schema>(d1Driver.drizzleDriver, { schema });

        yield* Effect.logInfo("database service initialized", {
            service_name: "Database",
            operation_type: "initialization",
            connection_state: "ready",
            account_id: config.D1_ACCOUNT_ID,
            database_id: config.D1_DATABASE_ID,
        });

        const users = {
            get: Effect.fn("Database.users.get")(function* (id: string) {
                yield* Effect.annotateCurrentSpan({ user_id: id, table: "users" });

                yield* Effect.logDebug("database query initiated", {
                    service_name: "Database",
                    method: "users.get",
                    operation_type: "select",
                    table: "users",
                    user_id: id,
                });

                type User = typeof schema.users.$inferSelect;

                const [duration, rows] = yield* Effect.tryPromise({
                    try: () =>
                        d1Driver.rawQuery<User>(
                            `SELECT id, discord_username, created_at, updated_at FROM users WHERE id = ?`,
                            [id],
                        ),
                    catch: (e) => new DatabaseError({ operation: "users.get", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);
                const found = rows[0] !== undefined;

                yield* Effect.annotateCurrentSpan({
                    duration_ms,
                    rows_returned: rows.length,
                    found,
                });

                yield* Effect.logInfo("database query completed", {
                    service_name: "Database",
                    method: "users.get",
                    operation_type: "select",
                    table: "users",
                    user_id: id,
                    duration_ms,
                    latency_ms: duration_ms,
                    rows_returned: rows.length,
                    found,
                });

                return Option.fromNullable(rows[0]);
            }),

            upsert: Effect.fn("Database.users.upsert")(function* (
                id: string,
                discordUsername: string,
            ) {
                yield* Effect.annotateCurrentSpan({
                    user_id: id,
                    table: "users",
                    discord_username: discordUsername,
                });

                yield* Effect.logDebug("database upsert initiated", {
                    service_name: "Database",
                    method: "users.upsert",
                    operation_type: "upsert",
                    table: "users",
                    user_id: id,
                    discord_username: discordUsername,
                });

                const [duration] = yield* Effect.tryPromise({
                    try: () =>
                        db
                            .insert(schema.users)
                            .values({
                                id,
                                discord_username: discordUsername,
                            })
                            .onConflictDoUpdate({
                                target: schema.users.id,
                                set: {
                                    discord_username: discordUsername,
                                    updated_at: sql`datetime('now')`,
                                },
                            }),
                    catch: (e) => new DatabaseError({ operation: "users.upsert", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms });

                yield* Effect.logInfo("database upsert completed", {
                    service_name: "Database",
                    method: "users.upsert",
                    operation_type: "upsert",
                    table: "users",
                    user_id: id,
                    discord_username: discordUsername,
                    duration_ms,
                    latency_ms: duration_ms,
                });
            }),

            delete: Effect.fn("Database.users.delete")(function* (id: string) {
                yield* Effect.annotateCurrentSpan({ user_id: id, table: "users" });

                yield* Effect.logDebug("database delete initiated", {
                    service_name: "Database",
                    method: "users.delete",
                    operation_type: "delete",
                    table: "users",
                    user_id: id,
                });

                const [duration] = yield* Effect.tryPromise({
                    try: () => db.delete(schema.users).where(eq(schema.users.id, id)),
                    catch: (e) => new DatabaseError({ operation: "users.delete", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms });

                yield* Effect.logInfo("database delete completed", {
                    service_name: "Database",
                    method: "users.delete",
                    operation_type: "delete",
                    table: "users",
                    user_id: id,
                    duration_ms,
                    latency_ms: duration_ms,
                });
            }),
        };

        const commitOverflowProfiles = {
            get: Effect.fn("Database.commitOverflowProfiles.get")(function* (userId: string) {
                yield* Effect.annotateCurrentSpan({
                    user_id: userId,
                    table: "commit_overflow_profiles",
                });

                yield* Effect.logDebug("database query initiated", {
                    service_name: "Database",
                    method: "commitOverflowProfiles.get",
                    operation_type: "select",
                    table: "commit_overflow_profiles",
                    user_id: userId,
                });

                type CommitOverflowProfile = typeof schema.commitOverflowProfiles.$inferSelect;

                const [duration, rows] = yield* Effect.tryPromise({
                    try: () =>
                        d1Driver.rawQuery<CommitOverflowProfile>(
                            `SELECT user_id, thread_id, timezone, created_at FROM commit_overflow_profiles WHERE user_id = ?`,
                            [userId],
                        ),
                    catch: (e) =>
                        new DatabaseError({ operation: "commitOverflowProfiles.get", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);
                const found = rows[0] !== undefined;

                yield* Effect.annotateCurrentSpan({
                    duration_ms,
                    rows_returned: rows.length,
                    found,
                });

                yield* Effect.logInfo("database query completed", {
                    service_name: "Database",
                    method: "commitOverflowProfiles.get",
                    operation_type: "select",
                    table: "commit_overflow_profiles",
                    user_id: userId,
                    duration_ms,
                    latency_ms: duration_ms,
                    rows_returned: rows.length,
                    found,
                });

                return Option.fromNullable(rows[0]);
            }),

            create: Effect.fn("Database.commitOverflowProfiles.create")(function* (
                userId: string,
                threadId: string,
            ) {
                yield* Effect.annotateCurrentSpan({
                    user_id: userId,
                    table: "commit_overflow_profiles",
                    thread_id: threadId,
                });

                yield* Effect.logDebug("database insert initiated", {
                    service_name: "Database",
                    method: "commitOverflowProfiles.create",
                    operation_type: "insert",
                    table: "commit_overflow_profiles",
                    user_id: userId,
                    thread_id: threadId,
                });

                const [duration] = yield* Effect.tryPromise({
                    try: () =>
                        db.insert(schema.commitOverflowProfiles).values({
                            user_id: userId,
                            thread_id: threadId,
                        }),
                    catch: (e) =>
                        new DatabaseError({ operation: "commitOverflowProfiles.create", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms });

                yield* Effect.logInfo("database insert completed", {
                    service_name: "Database",
                    method: "commitOverflowProfiles.create",
                    operation_type: "insert",
                    table: "commit_overflow_profiles",
                    user_id: userId,
                    thread_id: threadId,
                    duration_ms,
                    latency_ms: duration_ms,
                });
            }),

            delete: Effect.fn("Database.commitOverflowProfiles.delete")(function* (userId: string) {
                yield* Effect.annotateCurrentSpan({
                    user_id: userId,
                    table: "commit_overflow_profiles",
                });

                yield* Effect.logDebug("database delete initiated", {
                    service_name: "Database",
                    method: "commitOverflowProfiles.delete",
                    operation_type: "delete",
                    table: "commit_overflow_profiles",
                    user_id: userId,
                });

                const [duration] = yield* Effect.tryPromise({
                    try: () =>
                        db
                            .delete(schema.commitOverflowProfiles)
                            .where(eq(schema.commitOverflowProfiles.user_id, userId)),
                    catch: (e) =>
                        new DatabaseError({ operation: "commitOverflowProfiles.delete", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms });

                yield* Effect.logInfo("database delete completed", {
                    service_name: "Database",
                    method: "commitOverflowProfiles.delete",
                    operation_type: "delete",
                    table: "commit_overflow_profiles",
                    user_id: userId,
                    duration_ms,
                    latency_ms: duration_ms,
                });
            }),

            setTimezone: Effect.fn("Database.commitOverflowProfiles.setTimezone")(function* (
                userId: string,
                timezone: string,
            ) {
                yield* Effect.annotateCurrentSpan({
                    user_id: userId,
                    table: "commit_overflow_profiles",
                    timezone,
                });

                yield* Effect.logDebug("database update initiated", {
                    service_name: "Database",
                    method: "commitOverflowProfiles.setTimezone",
                    operation_type: "update",
                    table: "commit_overflow_profiles",
                    user_id: userId,
                    timezone,
                });

                const [duration] = yield* Effect.tryPromise({
                    try: () =>
                        db
                            .update(schema.commitOverflowProfiles)
                            .set({ timezone })
                            .where(eq(schema.commitOverflowProfiles.user_id, userId)),
                    catch: (e) =>
                        new DatabaseError({
                            operation: "commitOverflowProfiles.setTimezone",
                            cause: e,
                        }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms });

                yield* Effect.logInfo("database update completed", {
                    service_name: "Database",
                    method: "commitOverflowProfiles.setTimezone",
                    operation_type: "update",
                    table: "commit_overflow_profiles",
                    user_id: userId,
                    timezone,
                    duration_ms,
                    latency_ms: duration_ms,
                });
            }),

            setPrivate: Effect.fn("Database.commitOverflowProfiles.setPrivate")(function* (
                userId: string,
                isPrivate: boolean,
            ) {
                yield* Effect.annotateCurrentSpan({
                    user_id: userId,
                    table: "commit_overflow_profiles",
                    is_private: isPrivate,
                });

                yield* Effect.logDebug("database update initiated", {
                    service_name: "Database",
                    method: "commitOverflowProfiles.setPrivate",
                    operation_type: "update",
                    table: "commit_overflow_profiles",
                    user_id: userId,
                    is_private: isPrivate,
                });

                const [duration] = yield* Effect.tryPromise({
                    try: () =>
                        db
                            .update(schema.commitOverflowProfiles)
                            .set({ is_private: isPrivate })
                            .where(eq(schema.commitOverflowProfiles.user_id, userId)),
                    catch: (e) =>
                        new DatabaseError({
                            operation: "commitOverflowProfiles.setPrivate",
                            cause: e,
                        }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms });

                yield* Effect.logInfo("database update completed", {
                    service_name: "Database",
                    method: "commitOverflowProfiles.setPrivate",
                    operation_type: "update",
                    table: "commit_overflow_profiles",
                    user_id: userId,
                    is_private: isPrivate,
                    duration_ms,
                    latency_ms: duration_ms,
                });
            }),
        };

        const commits = {
            get: Effect.fn("Database.commits.get")(function* (messageId: string) {
                yield* Effect.annotateCurrentSpan({ message_id: messageId, table: "commits" });

                yield* Effect.logDebug("database query initiated", {
                    service_name: "Database",
                    method: "commits.get",
                    operation_type: "select",
                    table: "commits",
                    message_id: messageId,
                });

                type Commit = typeof schema.commits.$inferSelect;

                const [duration, rows] = yield* Effect.tryPromise({
                    try: () =>
                        d1Driver.rawQuery<Commit>(
                            `SELECT id, user_id, message_id, committed_at, approved_at, approved_by, created_at FROM commits WHERE message_id = ?`,
                            [messageId],
                        ),
                    catch: (e) => new DatabaseError({ operation: "commits.get", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);
                const found = rows[0] !== undefined;

                yield* Effect.annotateCurrentSpan({ duration_ms, found });

                yield* Effect.logInfo("database query completed", {
                    service_name: "Database",
                    method: "commits.get",
                    operation_type: "select",
                    table: "commits",
                    message_id: messageId,
                    duration_ms,
                    latency_ms: duration_ms,
                    rows_returned: rows.length,
                    found,
                });

                return Option.fromNullable(rows[0]);
            }),

            createApproved: Effect.fn("Database.commits.createApproved")(function* (data: {
                userId: string;
                messageId: string;
                committedAt: string;
                approvedBy: string;
                isPrivate?: boolean;
            }) {
                const isPrivate = data.isPrivate ?? false;

                yield* Effect.annotateCurrentSpan({
                    table: "commits",
                    user_id: data.userId,
                    is_private: isPrivate,
                });

                yield* Effect.logDebug("database insert initiated", {
                    service_name: "Database",
                    method: "commits.createApproved",
                    operation_type: "insert",
                    table: "commits",
                    user_id: data.userId,
                    message_id: data.messageId,
                    committed_at: data.committedAt,
                    approved_by: data.approvedBy,
                    is_private: isPrivate,
                });

                const [duration] = yield* Effect.tryPromise({
                    try: () =>
                        db.insert(schema.commits).values({
                            user_id: data.userId,
                            message_id: data.messageId,
                            committed_at: data.committedAt,
                            approved_at: new Date().toISOString(),
                            approved_by: data.approvedBy,
                            is_private: isPrivate,
                        }),
                    catch: (e) =>
                        new DatabaseError({ operation: "commits.createApproved", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms });

                yield* Effect.logInfo("database insert completed", {
                    service_name: "Database",
                    method: "commits.createApproved",
                    operation_type: "insert",
                    table: "commits",
                    user_id: data.userId,
                    message_id: data.messageId,
                    committed_at: data.committedAt,
                    approved_by: data.approvedBy,
                    is_private: isPrivate,
                    duration_ms,
                    latency_ms: duration_ms,
                });
            }),

            getByUser: Effect.fn("Database.commits.getByUser")(function* (userId: string) {
                yield* Effect.annotateCurrentSpan({ user_id: userId, table: "commits" });

                yield* Effect.logDebug("database query initiated", {
                    service_name: "Database",
                    method: "commits.getByUser",
                    operation_type: "select",
                    table: "commits",
                    user_id: userId,
                });

                type Commit = typeof schema.commits.$inferSelect;

                const [duration, rows] = yield* Effect.tryPromise({
                    try: () =>
                        d1Driver.rawQuery<Commit>(
                            `SELECT id, user_id, message_id, committed_at, approved_at, approved_by, created_at FROM commits WHERE user_id = ? ORDER BY committed_at`,
                            [userId],
                        ),
                    catch: (e) => new DatabaseError({ operation: "commits.getByUser", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms, rows_returned: rows.length });

                yield* Effect.logInfo("database query completed", {
                    service_name: "Database",
                    method: "commits.getByUser",
                    operation_type: "select",
                    table: "commits",
                    user_id: userId,
                    duration_ms,
                    latency_ms: duration_ms,
                    rows_returned: rows.length,
                });

                return rows;
            }),

            getApprovedCount: Effect.fn("Database.commits.getApprovedCount")(function* (
                userId: string,
            ) {
                yield* Effect.annotateCurrentSpan({ user_id: userId, table: "commits" });

                yield* Effect.logDebug("database query initiated", {
                    service_name: "Database",
                    method: "commits.getApprovedCount",
                    operation_type: "select",
                    table: "commits",
                    user_id: userId,
                });

                const [duration, rows] = yield* Effect.tryPromise({
                    try: () =>
                        db.select().from(schema.commits).where(eq(schema.commits.user_id, userId)),
                    catch: (e) =>
                        new DatabaseError({
                            operation: "commits.getApprovedCount",
                            cause: e,
                        }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms, count: rows.length });

                yield* Effect.logInfo("database query completed", {
                    service_name: "Database",
                    method: "commits.getApprovedCount",
                    operation_type: "select",
                    table: "commits",
                    user_id: userId,
                    duration_ms,
                    latency_ms: duration_ms,
                    rows_returned: rows.length,
                    count: rows.length,
                });

                return rows.length;
            }),

            getCommitTimestamps: Effect.fn("Database.commits.getCommitTimestamps")(function* (
                userId: string,
            ) {
                yield* Effect.annotateCurrentSpan({ user_id: userId, table: "commits" });

                yield* Effect.logDebug("database query initiated", {
                    service_name: "Database",
                    method: "commits.getCommitTimestamps",
                    operation_type: "select",
                    table: "commits",
                    user_id: userId,
                });

                const [duration, rows] = yield* Effect.tryPromise({
                    try: () =>
                        d1Driver.rawQuery<{ committed_at: string }>(
                            `SELECT committed_at FROM commits WHERE user_id = ?`,
                            [userId],
                        ),
                    catch: (e) =>
                        new DatabaseError({
                            operation: "commits.getCommitTimestamps",
                            cause: e,
                        }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms, commit_count: rows.length });

                yield* Effect.logInfo("database query completed", {
                    service_name: "Database",
                    method: "commits.getCommitTimestamps",
                    operation_type: "select",
                    table: "commits",
                    user_id: userId,
                    duration_ms,
                    latency_ms: duration_ms,
                    rows_returned: rows.length,
                    commit_count: rows.length,
                });

                return rows.map((r) => r.committed_at);
            }),

            deleteByUser: Effect.fn("Database.commits.deleteByUser")(function* (userId: string) {
                yield* Effect.annotateCurrentSpan({ user_id: userId, table: "commits" });

                yield* Effect.logDebug("database delete initiated", {
                    service_name: "Database",
                    method: "commits.deleteByUser",
                    operation_type: "delete",
                    table: "commits",
                    user_id: userId,
                });

                const [duration] = yield* Effect.tryPromise({
                    try: () => db.delete(schema.commits).where(eq(schema.commits.user_id, userId)),
                    catch: (e) =>
                        new DatabaseError({ operation: "commits.deleteByUser", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms });

                yield* Effect.logInfo("database delete completed", {
                    service_name: "Database",
                    method: "commits.deleteByUser",
                    operation_type: "delete",
                    table: "commits",
                    user_id: userId,
                    duration_ms,
                    latency_ms: duration_ms,
                });
            }),

            setExplicitlyPrivate: Effect.fn("Database.commits.setExplicitlyPrivate")(function* (
                messageId: string,
                isExplicitlyPrivate: boolean,
                isPrivate: boolean,
            ) {
                yield* Effect.annotateCurrentSpan({
                    message_id: messageId,
                    table: "commits",
                    is_explicitly_private: isExplicitlyPrivate,
                    is_private: isPrivate,
                });

                yield* Effect.logDebug("database update initiated", {
                    service_name: "Database",
                    method: "commits.setExplicitlyPrivate",
                    operation_type: "update",
                    table: "commits",
                    message_id: messageId,
                    is_explicitly_private: isExplicitlyPrivate,
                    is_private: isPrivate,
                });

                const [duration] = yield* Effect.tryPromise({
                    try: () =>
                        db
                            .update(schema.commits)
                            .set({
                                is_explicitly_private: isExplicitlyPrivate,
                                is_private: isPrivate,
                            })
                            .where(eq(schema.commits.message_id, messageId)),
                    catch: (e) =>
                        new DatabaseError({ operation: "commits.setExplicitlyPrivate", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms });

                yield* Effect.logInfo("database update completed", {
                    service_name: "Database",
                    method: "commits.setExplicitlyPrivate",
                    operation_type: "update",
                    table: "commits",
                    message_id: messageId,
                    is_explicitly_private: isExplicitlyPrivate,
                    is_private: isPrivate,
                    duration_ms,
                    latency_ms: duration_ms,
                });
            }),

            bulkSetPrivate: Effect.fn("Database.commits.bulkSetPrivate")(function* (
                userId: string,
                isPrivate: boolean,
                excludeExplicitlyPrivate: boolean,
            ) {
                yield* Effect.annotateCurrentSpan({
                    user_id: userId,
                    table: "commits",
                    is_private: isPrivate,
                    exclude_explicitly_private: excludeExplicitlyPrivate,
                });

                yield* Effect.logDebug("database bulk update initiated", {
                    service_name: "Database",
                    method: "commits.bulkSetPrivate",
                    operation_type: "update",
                    table: "commits",
                    user_id: userId,
                    is_private: isPrivate,
                    exclude_explicitly_private: excludeExplicitlyPrivate,
                });

                const query = excludeExplicitlyPrivate
                    ? `UPDATE commits SET is_private = ? WHERE user_id = ? AND is_explicitly_private = 0`
                    : `UPDATE commits SET is_private = ? WHERE user_id = ?`;

                const params = [isPrivate ? 1 : 0, userId];

                const [duration] = yield* Effect.tryPromise({
                    try: () => d1Driver.rawQuery(query, params),
                    catch: (e) =>
                        new DatabaseError({ operation: "commits.bulkSetPrivate", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms });

                yield* Effect.logInfo("database bulk update completed", {
                    service_name: "Database",
                    method: "commits.bulkSetPrivate",
                    operation_type: "update",
                    table: "commits",
                    user_id: userId,
                    is_private: isPrivate,
                    exclude_explicitly_private: excludeExplicitlyPrivate,
                    duration_ms,
                    latency_ms: duration_ms,
                });
            }),
        };

        return { users, commitOverflowProfiles, commits } as const;
    }).pipe(Effect.annotateLogs({ service: "Database" })),
}) {}

/** @deprecated Use Database.Default instead */
export const DatabaseLive = Database.Default;
