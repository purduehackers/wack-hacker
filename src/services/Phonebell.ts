import { Duration, Effect, Redacted } from "effect";

import { AppConfig } from "../config";
import { PhonebellError } from "../errors";

export class Phonebell extends Effect.Service<Phonebell>()("Phonebell", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;
        const phonebellOpenUrl = config.PHONEBELL_OPEN_URL;
        const apiToken = Redacted.value(config.PHACK_API_TOKEN);

        const openDoor = Effect.fn("Phonebell.openDoor")(function* (requestedByUserId: string) {
            yield* Effect.annotateCurrentSpan({
                requested_by_user_id: requestedByUserId,
                phonebell_open_url: phonebellOpenUrl,
            });

            yield* Effect.logDebug("phonebell open request initiated", {
                service_name: "Phonebell",
                method: "openDoor",
                operation_type: "api_request",
                requested_by_user_id: requestedByUserId,
                endpoint: phonebellOpenUrl,
                http_method: "POST",
            });

            const [duration, response] = yield* Effect.tryPromise({
                try: () =>
                    fetch(
                        new Request(phonebellOpenUrl, {
                            method: "POST",
                            headers: {
                                Authorization: `Bearer ${apiToken}`,
                            },
                        }),
                    ),
                catch: (cause) => new PhonebellError({ operation: "openDoor.request", cause }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            if (!response.ok) {
                const responseBody = yield* Effect.tryPromise({
                    try: () => response.text(),
                    catch: (cause) => new PhonebellError({ operation: "openDoor.readBody", cause }),
                }).pipe(Effect.catchAll(() => Effect.succeed("")));
                const responseBodyPreview = responseBody.slice(0, 300);

                yield* Effect.annotateCurrentSpan({
                    duration_ms,
                    http_status: response.status,
                    status: "failed",
                });

                yield* Effect.logWarning("phonebell open request failed", {
                    service_name: "Phonebell",
                    method: "openDoor",
                    operation_type: "api_request",
                    requested_by_user_id: requestedByUserId,
                    endpoint: phonebellOpenUrl,
                    http_method: "POST",
                    http_status: response.status,
                    response_body_length: responseBody.length,
                    response_body_preview: responseBodyPreview,
                    duration_ms,
                    latency_ms: duration_ms,
                });

                return yield* Effect.fail(
                    new PhonebellError({
                        operation: "openDoor.httpError",
                        cause: new Error(`Phonebell returned HTTP ${response.status}`),
                    }),
                );
            }

            yield* Effect.annotateCurrentSpan({
                duration_ms,
                http_status: response.status,
                status: "success",
            });

            yield* Effect.logInfo("phonebell open request completed", {
                service_name: "Phonebell",
                method: "openDoor",
                operation_type: "api_request",
                requested_by_user_id: requestedByUserId,
                endpoint: phonebellOpenUrl,
                http_method: "POST",
                http_status: response.status,
                duration_ms,
                latency_ms: duration_ms,
            });

            return { http_status: response.status, duration_ms } as const;
        });

        return { openDoor } as const;
    }).pipe(Effect.annotateLogs({ service: "Phonebell" })),
}) {}

/** @deprecated Use Phonebell.Default instead */
export const PhonebellLive = Phonebell.Default;
