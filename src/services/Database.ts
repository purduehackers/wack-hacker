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

const createD1Driver = (
    accountId: string,
    databaseId: string,
    apiToken: string,
    onQueryComplete?: (durationMs: number, rowCount: number) => void,
) => {
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;

    return async (
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

        const db = drizzle<typeof schema>(
            createD1Driver(
                config.D1_ACCOUNT_ID,
                config.D1_DATABASE_ID,
                Redacted.value(config.D1_API_TOKEN),
            ),
            { schema },
        );

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

                const [duration, result] = yield* Effect.tryPromise({
                    try: () => db.select().from(schema.users).where(eq(schema.users.id, id)),
                    catch: (e) => new DatabaseError({ operation: "users.get", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);
                const found = result[0] !== undefined;

                yield* Effect.annotateCurrentSpan({
                    duration_ms,
                    rows_returned: result.length,
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
                    rows_returned: result.length,
                    found,
                });

                return Option.fromNullable(result[0]);
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

                const [duration, result] = yield* Effect.tryPromise({
                    try: () =>
                        db
                            .select()
                            .from(schema.commitOverflowProfiles)
                            .where(eq(schema.commitOverflowProfiles.user_id, userId)),
                    catch: (e) =>
                        new DatabaseError({ operation: "commitOverflowProfiles.get", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);
                const found = result[0] !== undefined;

                yield* Effect.annotateCurrentSpan({
                    duration_ms,
                    rows_returned: result.length,
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
                    rows_returned: result.length,
                    found,
                });

                return Option.fromNullable(result[0]);
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

                const [duration, result] = yield* Effect.tryPromise({
                    try: () =>
                        db
                            .select()
                            .from(schema.commits)
                            .where(eq(schema.commits.message_id, messageId)),
                    catch: (e) => new DatabaseError({ operation: "commits.get", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);
                const found = result[0] !== undefined;

                yield* Effect.annotateCurrentSpan({ duration_ms, found });

                yield* Effect.logInfo("database query completed", {
                    service_name: "Database",
                    method: "commits.get",
                    operation_type: "select",
                    table: "commits",
                    message_id: messageId,
                    duration_ms,
                    latency_ms: duration_ms,
                    rows_returned: result.length,
                    found,
                });

                return Option.fromNullable(result[0]);
            }),

            createApproved: Effect.fn("Database.commits.createApproved")(function* (data: {
                userId: string;
                messageId: string;
                commitDay: string;
                approvedBy: string;
            }) {
                yield* Effect.annotateCurrentSpan({
                    table: "commits",
                    user_id: data.userId,
                });

                yield* Effect.logDebug("database insert initiated", {
                    service_name: "Database",
                    method: "commits.createApproved",
                    operation_type: "insert",
                    table: "commits",
                    user_id: data.userId,
                    message_id: data.messageId,
                    commit_day: data.commitDay,
                    approved_by: data.approvedBy,
                });

                const [duration] = yield* Effect.tryPromise({
                    try: () =>
                        db.insert(schema.commits).values({
                            user_id: data.userId,
                            message_id: data.messageId,
                            commit_day: data.commitDay,
                            approved_at: new Date().toISOString(),
                            approved_by: data.approvedBy,
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
                    commit_day: data.commitDay,
                    approved_by: data.approvedBy,
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

                const [duration, result] = yield* Effect.tryPromise({
                    try: () =>
                        db
                            .select()
                            .from(schema.commits)
                            .where(eq(schema.commits.user_id, userId))
                            .orderBy(schema.commits.commit_day),
                    catch: (e) => new DatabaseError({ operation: "commits.getByUser", cause: e }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms, rows_returned: result.length });

                yield* Effect.logInfo("database query completed", {
                    service_name: "Database",
                    method: "commits.getByUser",
                    operation_type: "select",
                    table: "commits",
                    user_id: userId,
                    duration_ms,
                    latency_ms: duration_ms,
                    rows_returned: result.length,
                });

                return result;
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

            getDistinctDays: Effect.fn("Database.commits.getDistinctDays")(function* (
                userId: string,
            ) {
                yield* Effect.annotateCurrentSpan({ user_id: userId, table: "commits" });

                yield* Effect.logDebug("database query initiated", {
                    service_name: "Database",
                    method: "commits.getDistinctDays",
                    operation_type: "select_distinct",
                    table: "commits",
                    user_id: userId,
                });

                const [duration, rows] = yield* Effect.tryPromise({
                    try: () =>
                        db
                            .selectDistinct({ commit_day: schema.commits.commit_day })
                            .from(schema.commits)
                            .where(eq(schema.commits.user_id, userId)),
                    catch: (e) =>
                        new DatabaseError({
                            operation: "commits.getDistinctDays",
                            cause: e,
                        }),
                }).pipe(Effect.timed);

                const duration_ms = Duration.toMillis(duration);

                yield* Effect.annotateCurrentSpan({ duration_ms, distinct_days: rows.length });

                yield* Effect.logInfo("database query completed", {
                    service_name: "Database",
                    method: "commits.getDistinctDays",
                    operation_type: "select_distinct",
                    table: "commits",
                    user_id: userId,
                    duration_ms,
                    latency_ms: duration_ms,
                    rows_returned: rows.length,
                    distinct_days: rows.length,
                });

                return rows.map((r) => r.commit_day);
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
        };

        return { users, commitOverflowProfiles, commits } as const;
    }).pipe(Effect.annotateLogs({ service: "Database" })),
}) {}

/** @deprecated Use Database.Default instead */
export const DatabaseLive = Database.Default;
