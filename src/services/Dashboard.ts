import { Effect, Ref, Duration, Schedule, Redacted } from "effect";

import { AppConfig } from "../config";
import { DashboardError, DashboardConnectionFailed, structuredError } from "../errors";

export interface DiscordMessage {
    image: string | null;
    timestamp: string;
    username: string;
    content: string;
    attachments?: string[];
}

type ConnectionState =
    | { _tag: "Disconnected" }
    | { _tag: "Connecting" }
    | { _tag: "Connected"; ws: WebSocket }
    | { _tag: "Failed"; error: unknown };

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

export class Dashboard extends Effect.Service<Dashboard>()("Dashboard", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;
        const wsUrl = config.DASHBOARD_WS_URL;
        const apiToken = Redacted.value(config.PHACK_API_TOKEN);
        const stateRef = yield* Ref.make<ConnectionState>({ _tag: "Disconnected" });

        const connectOnce = Effect.async<WebSocket, DashboardError>((resume) => {
            const connectStartTime = Date.now();
            const socket = new WebSocket(wsUrl);
            let authTimeout: Timer;

            const cleanup = () => {
                clearTimeout(authTimeout);
                socket.onmessage = null;
                socket.onclose = null;
                socket.onerror = null;
            };

            socket.onerror = () => {
                cleanup();
                const durationMs = Date.now() - connectStartTime;
                resume(
                    Effect.fail(
                        new DashboardError({
                            operation: "connect",
                            cause: "WebSocket error",
                        }),
                    ).pipe(
                        Effect.tap(() =>
                            Effect.logError("websocket connection failed", {
                                service_name: "Dashboard",
                                method: "connectOnce",
                                operation_type: "websocket_connect",
                                ws_url: wsUrl,
                                connection_state: "error",
                                duration_ms: durationMs,
                                latency_ms: durationMs,
                                ready_state: socket.readyState,
                                error_type: "socket_error",
                            }),
                        ),
                    ),
                );
            };

            socket.onclose = () => {
                cleanup();
                const durationMs = Date.now() - connectStartTime;
                resume(
                    Effect.fail(
                        new DashboardError({
                            operation: "connect",
                            cause: "Socket closed before auth",
                        }),
                    ).pipe(
                        Effect.tap(() =>
                            Effect.logWarning("websocket closed before auth", {
                                service_name: "Dashboard",
                                method: "connectOnce",
                                operation_type: "websocket_connect",
                                ws_url: wsUrl,
                                connection_state: "closed",
                                duration_ms: durationMs,
                                latency_ms: durationMs,
                                ready_state: socket.readyState,
                                phase: "pre_auth",
                            }),
                        ),
                    ),
                );
            };

            socket.onopen = () => {
                const openDurationMs = Date.now() - connectStartTime;

                Effect.runSync(
                    Effect.logDebug("websocket opened", {
                        service_name: "Dashboard",
                        method: "connectOnce",
                        operation_type: "websocket_connect",
                        ws_url: wsUrl,
                        connection_state: "open",
                        duration_ms: openDurationMs,
                        latency_ms: openDurationMs,
                        ready_state: socket.readyState,
                        phase: "awaiting_auth",
                    }),
                );

                socket.send(JSON.stringify({ token: apiToken }));

                Effect.runSync(
                    Effect.logDebug("auth token sent", {
                        service_name: "Dashboard",
                        method: "connectOnce",
                        operation_type: "websocket_auth",
                        ws_url: wsUrl,
                        connection_state: "open",
                        phase: "auth_sent",
                        timeout_ms: 3000,
                    }),
                );

                authTimeout = setTimeout(() => {
                    cleanup();
                    socket.close();
                    const timeoutDurationMs = Date.now() - connectStartTime;
                    resume(
                        Effect.fail(
                            new DashboardError({
                                operation: "connect",
                                cause: "Auth timeout",
                            }),
                        ).pipe(
                            Effect.tap(() =>
                                Effect.logError("auth timeout", {
                                    service_name: "Dashboard",
                                    method: "connectOnce",
                                    operation_type: "websocket_auth",
                                    ws_url: wsUrl,
                                    connection_state: "timeout",
                                    duration_ms: timeoutDurationMs,
                                    latency_ms: timeoutDurationMs,
                                    timeout_threshold_ms: 3000,
                                    phase: "auth_timeout",
                                    error_type: "timeout",
                                }),
                            ),
                        ),
                    );
                }, 3000);

                socket.onmessage = (event) => {
                    const messageReceivedTime = Date.now();
                    const authDurationMs = messageReceivedTime - connectStartTime;

                    try {
                        const msg = JSON.parse(event.data as string) as {
                            auth?: string;
                        };

                        Effect.runSync(
                            Effect.logDebug("auth message received", {
                                service_name: "Dashboard",
                                method: "connectOnce",
                                operation_type: "websocket_auth",
                                ws_url: wsUrl,
                                connection_state: "open",
                                message_type: "auth_response",
                                auth_status: msg?.auth || "unknown",
                                duration_ms: authDurationMs,
                                latency_ms: authDurationMs,
                            }),
                        );

                        if (msg?.auth === "complete") {
                            cleanup();
                            Effect.runSync(
                                Effect.logInfo("websocket connected", {
                                    service_name: "Dashboard",
                                    method: "connectOnce",
                                    operation_type: "websocket_connect",
                                    ws_url: wsUrl,
                                    connection_state: "authenticated",
                                    duration_ms: authDurationMs,
                                    latency_ms: authDurationMs,
                                    ready_state: socket.readyState,
                                    auth_result: "complete",
                                }),
                            );
                            resume(Effect.succeed(socket));
                        } else if (msg?.auth === "rejected") {
                            cleanup();
                            socket.close();
                            resume(
                                Effect.fail(
                                    new DashboardError({
                                        operation: "connect",
                                        cause: "Auth rejected",
                                    }),
                                ).pipe(
                                    Effect.tap(() =>
                                        Effect.logError("auth rejected", {
                                            service_name: "Dashboard",
                                            method: "connectOnce",
                                            operation_type: "websocket_auth",
                                            ws_url: wsUrl,
                                            connection_state: "rejected",
                                            duration_ms: authDurationMs,
                                            latency_ms: authDurationMs,
                                            auth_result: "rejected",
                                            error_type: "auth_rejected",
                                        }),
                                    ),
                                ),
                            );
                        }
                    } catch (parseError) {
                        Effect.runSync(
                            Effect.logWarning("failed to parse auth message", {
                                service_name: "Dashboard",
                                method: "connectOnce",
                                operation_type: "websocket_auth",
                                ws_url: wsUrl,
                                connection_state: "open",
                                message_type: "parse_error",
                                duration_ms: authDurationMs,
                                latency_ms: authDurationMs,
                                error: String(parseError),
                                error_type: "parse_failed",
                            }),
                        );
                    }
                };
            };
        });

        const retrySchedule = Schedule.exponential(Duration.millis(BASE_DELAY_MS), 2).pipe(
            Schedule.intersect(Schedule.recurs(MAX_RETRIES)),
            Schedule.upTo(Duration.millis(MAX_DELAY_MS)),
        );

        const connectWithRetry = connectOnce.pipe(
            Effect.tap(() =>
                Effect.zipRight(
                    Effect.logDebug("dashboard connecting", {
                        service_name: "Dashboard",
                        method: "connectWithRetry",
                        operation_type: "websocket_connect",
                        ws_url: wsUrl,
                        connection_state: "connecting",
                        max_retries: MAX_RETRIES,
                        base_delay_ms: BASE_DELAY_MS,
                        max_delay_ms: MAX_DELAY_MS,
                    }),
                    Ref.set(stateRef, { _tag: "Connecting" }),
                ),
            ),
            Effect.retry(retrySchedule),
            Effect.tap((ws) =>
                Effect.zipRight(
                    Effect.logInfo("dashboard connected", {
                        service_name: "Dashboard",
                        method: "connectWithRetry",
                        operation_type: "websocket_connect",
                        ws_url: wsUrl,
                        connection_state: "connected",
                        ready_state: ws.readyState,
                    }),
                    Ref.set(stateRef, { _tag: "Connected", ws }),
                ),
            ),
            Effect.mapError(
                (e) =>
                    new DashboardConnectionFailed({
                        attempts: MAX_RETRIES,
                        lastError: e,
                    }),
            ),
        );

        const send = Effect.fn("Dashboard.send")(
            function* (message: DiscordMessage) {
                const sendStartTime = Date.now();
                const state = yield* Ref.get(stateRef);

                yield* Effect.annotateCurrentSpan({
                    username: message.username,
                    has_attachments:
                        message.attachments !== undefined && message.attachments.length > 0,
                    attachment_count: message.attachments?.length || 0,
                    content_length: message.content.length,
                    state_tag: state._tag,
                });

                yield* Effect.logDebug("dashboard send initiated", {
                    service_name: "Dashboard",
                    method: "send",
                    operation_type: "websocket_send",
                    connection_state: state._tag.toLowerCase(),
                    username: message.username,
                    content_length: message.content.length,
                    has_attachments:
                        message.attachments !== undefined && message.attachments.length > 0,
                    attachment_count: message.attachments?.length || 0,
                });

                const ws: WebSocket | null = yield* (() => {
                    switch (state._tag) {
                        case "Connected":
                            if (state.ws.readyState === WebSocket.OPEN) {
                                return Effect.succeed(state.ws).pipe(
                                    Effect.tap(() =>
                                        Effect.logDebug("using existing connection", {
                                            service_name: "Dashboard",
                                            method: "send",
                                            operation_type: "websocket_send",
                                            connection_state: "connected",
                                            ready_state: state.ws.readyState,
                                            ws_url: wsUrl,
                                        }),
                                    ),
                                );
                            }
                            return connectWithRetry.pipe(
                                Effect.tap(() =>
                                    Effect.logWarning("reconnecting due to closed socket", {
                                        service_name: "Dashboard",
                                        method: "send",
                                        operation_type: "websocket_reconnect",
                                        connection_state: "reconnecting",
                                        previous_ready_state: state.ws.readyState,
                                        ws_url: wsUrl,
                                    }),
                                ),
                                Effect.catchAll((e) =>
                                    Effect.zipRight(
                                        Effect.logError("reconnection failed", {
                                            service_name: "Dashboard",
                                            method: "send",
                                            operation_type: "websocket_reconnect",
                                            connection_state: "failed",
                                            ws_url: wsUrl,
                                            ...structuredError(e),
                                            error_type: "reconnect_failed",
                                        }),
                                        Effect.succeed(null),
                                    ),
                                ),
                            );

                        case "Disconnected":
                        case "Failed":
                            return connectWithRetry.pipe(
                                Effect.tap(() =>
                                    Effect.logInfo("connecting from disconnected state", {
                                        service_name: "Dashboard",
                                        method: "send",
                                        operation_type: "websocket_connect",
                                        connection_state: "connecting",
                                        previous_state: state._tag.toLowerCase(),
                                        ws_url: wsUrl,
                                    }),
                                ),
                                Effect.catchAll((e) =>
                                    Effect.zipRight(
                                        Effect.logError("connection attempt failed", {
                                            service_name: "Dashboard",
                                            method: "send",
                                            operation_type: "websocket_connect",
                                            connection_state: "failed",
                                            previous_state: state._tag.toLowerCase(),
                                            ws_url: wsUrl,
                                            ...structuredError(e),
                                            error_type: "connect_failed",
                                        }),
                                        Effect.succeed(null),
                                    ),
                                ),
                            );

                        case "Connecting":
                            return Effect.sleep(Duration.millis(500)).pipe(
                                Effect.tap(() =>
                                    Effect.logDebug("waiting for connection", {
                                        service_name: "Dashboard",
                                        method: "send",
                                        operation_type: "websocket_wait",
                                        connection_state: "connecting",
                                        wait_duration_ms: 500,
                                        ws_url: wsUrl,
                                    }),
                                ),
                                Effect.flatMap(() => Effect.succeed(null)),
                            );
                    }
                })();

                if (ws && ws.readyState === WebSocket.OPEN) {
                    const messagePayload = JSON.stringify(message);
                    const payloadSize = new Blob([messagePayload]).size;

                    ws.send(messagePayload);

                    const durationMs = Date.now() - sendStartTime;

                    yield* Effect.logInfo("message sent to dashboard", {
                        service_name: "Dashboard",
                        method: "send",
                        operation_type: "websocket_send",
                        connection_state: "open",
                        ready_state: ws.readyState,
                        duration_ms: durationMs,
                        latency_ms: durationMs,
                        username: message.username,
                        content_length: message.content.length,
                        payload_size_bytes: payloadSize,
                        has_attachments:
                            message.attachments !== undefined && message.attachments.length > 0,
                        attachment_count: message.attachments?.length || 0,
                        ws_url: wsUrl,
                    });
                } else {
                    const durationMs = Date.now() - sendStartTime;

                    yield* Effect.logWarning("message not sent", {
                        service_name: "Dashboard",
                        method: "send",
                        operation_type: "websocket_send",
                        connection_state: ws ? "closed" : "unavailable",
                        ready_state: ws?.readyState || "null",
                        duration_ms: durationMs,
                        latency_ms: durationMs,
                        username: message.username,
                        content_length: message.content.length,
                        ws_url: wsUrl,
                        reason: ws ? "socket_not_open" : "no_socket",
                        error_type: "send_skipped",
                    });
                }
            },
            (effect) =>
                effect.pipe(
                    Effect.catchAll((e) =>
                        Effect.logError("dashboard send failed", {
                            service_name: "Dashboard",
                            method: "send",
                            operation_type: "websocket_send",
                            ...structuredError(e),
                            ws_url: wsUrl,
                            error_type: "send_error",
                        }).pipe(Effect.andThen(Effect.void)),
                    ),
                ),
        );

        const connect = Effect.fn("Dashboard.connect")(function* () {
            yield* Effect.logInfo("dashboard connect requested", {
                service_name: "Dashboard",
                method: "connect",
                operation_type: "websocket_connect",
                ws_url: wsUrl,
            });
            return yield* connectWithRetry;
        });

        const disconnect = Effect.fn("Dashboard.disconnect")(function* () {
            const state = yield* Ref.get(stateRef);

            yield* Effect.logInfo("dashboard disconnect requested", {
                service_name: "Dashboard",
                method: "disconnect",
                operation_type: "websocket_disconnect",
                ws_url: wsUrl,
                connection_state: state._tag.toLowerCase(),
            });

            if (state._tag === "Connected") {
                const readyState = state.ws.readyState;
                state.ws.close();

                yield* Effect.logInfo("websocket closed", {
                    service_name: "Dashboard",
                    method: "disconnect",
                    operation_type: "websocket_disconnect",
                    ws_url: wsUrl,
                    connection_state: "disconnected",
                    previous_ready_state: readyState,
                });
            } else {
                yield* Effect.logDebug("disconnect called on non-connected state", {
                    service_name: "Dashboard",
                    method: "disconnect",
                    operation_type: "websocket_disconnect",
                    ws_url: wsUrl,
                    connection_state: state._tag.toLowerCase(),
                });
            }

            yield* Ref.set(stateRef, { _tag: "Disconnected" });
        });

        return { send, connect, disconnect } as const;
    }).pipe(Effect.annotateLogs({ service: "Dashboard" })),
}) {}

/** @deprecated Use Dashboard.Default instead */
export const DashboardLive = Dashboard.Default;
