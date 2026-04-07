import { Duration, Effect, Redacted } from "effect";

import { AppConfig } from "../config";
import { PrivacyDBError } from "../errors";

export type Mode = "opt_in" | "opt_out_privacy" | "opt_out_collection";
export type Project = "commit-overflow" | "ships";

export interface UserPreferences {
    user_id: string;
    mode: Mode;
    overrides: Record<string, Mode>;
}

export class PrivacyDB extends Effect.Service<PrivacyDB>()("PrivacyDB", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;
        const baseUrl = config.PRIVACY_DB_URL.replace(/\/$/, "");
        const apiKey = Redacted.value(config.PRIVACY_DB_API_KEY);

        yield* Effect.logInfo("privacydb service initialized", {
            service_name: "PrivacyDB",
            operation_type: "initialization",
            base_url: baseUrl,
        });

        const request = Effect.fn("PrivacyDB.request")(function* <T>(
            method: string,
            path: string,
            body?: unknown,
        ) {
            const url = `${baseUrl}${path}`;

            yield* Effect.annotateCurrentSpan({
                http_method: method,
                url,
            });

            yield* Effect.logDebug("privacydb request initiated", {
                service_name: "PrivacyDB",
                method: "request",
                http_method: method,
                url,
            });

            const [duration, response] = yield* Effect.tryPromise({
                try: () =>
                    fetch(url, {
                        method,
                        headers: {
                            Authorization: `Bearer ${apiKey}`,
                            "Content-Type": "application/json",
                        },
                        body: body ? JSON.stringify(body) : undefined,
                    }),
                catch: (cause) => new PrivacyDBError({ operation: "request.fetch", cause }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            if (!response.ok) {
                const text = yield* Effect.tryPromise({
                    try: () => response.text(),
                    catch: (cause) => new PrivacyDBError({ operation: "request.readBody", cause }),
                }).pipe(Effect.catchAll(() => Effect.succeed("")));

                yield* Effect.logError("privacydb request failed", {
                    service_name: "PrivacyDB",
                    http_method: method,
                    url,
                    status: response.status,
                    response_body: text.slice(0, 300),
                    duration_ms,
                });

                return yield* Effect.fail(
                    new PrivacyDBError({
                        operation: "request",
                        cause: `HTTP ${response.status}: ${text.slice(0, 200)}`,
                    }),
                );
            }

            const data = yield* Effect.tryPromise({
                try: () => response.json() as Promise<T>,
                catch: (cause) => new PrivacyDBError({ operation: "request.parseJson", cause }),
            });

            yield* Effect.logDebug("privacydb request completed", {
                service_name: "PrivacyDB",
                http_method: method,
                url,
                status: response.status,
                duration_ms,
            });

            return data;
        });

        const getPreferences = Effect.fn("PrivacyDB.getPreferences")(function* (userId: string) {
            yield* Effect.annotateCurrentSpan({ user_id: userId });
            return yield* request<UserPreferences>("GET", `/preferences/${userId}`);
        });

        const setGlobalMode = Effect.fn("PrivacyDB.setGlobalMode")(function* (
            userId: string,
            mode: Mode,
            reason?: string,
        ) {
            yield* Effect.annotateCurrentSpan({ user_id: userId, mode });
            return yield* request<{ ok: boolean; wipe_results?: Record<string, { ok: boolean }> }>(
                "PUT",
                `/preferences/${userId}`,
                { mode, reason },
            );
        });

        const resetPreferences = Effect.fn("PrivacyDB.resetPreferences")(function* (
            userId: string,
        ) {
            yield* Effect.annotateCurrentSpan({ user_id: userId });
            return yield* request<{ ok: boolean }>("DELETE", `/preferences/${userId}`);
        });

        const setProjectOverride = Effect.fn("PrivacyDB.setProjectOverride")(function* (
            userId: string,
            project: Project,
            mode: Mode,
            reason?: string,
        ) {
            yield* Effect.annotateCurrentSpan({ user_id: userId, project, mode });
            return yield* request<{ ok: boolean }>("PUT", `/preferences/${userId}/${project}`, {
                mode,
                reason,
            });
        });

        const removeProjectOverride = Effect.fn("PrivacyDB.removeProjectOverride")(function* (
            userId: string,
            project: Project,
        ) {
            yield* Effect.annotateCurrentSpan({ user_id: userId, project });
            return yield* request<{ ok: boolean }>("DELETE", `/preferences/${userId}/${project}`);
        });

        return {
            getPreferences,
            setGlobalMode,
            resetPreferences,
            setProjectOverride,
            removeProjectOverride,
        } as const;
    }).pipe(Effect.annotateLogs({ service: "PrivacyDB" })),
}) {}
