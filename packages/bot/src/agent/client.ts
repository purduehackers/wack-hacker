/**
 * The bot's HTTP client for the agent.
 *
 * Four calls, one per route on the agent's custom Discord channel. Everything
 * the bot knows about the agent is here and in `@repo/shared/wire`.
 *
 * The retry policy differs per route on purpose, and the distinction is
 * correctness rather than tuning:
 *
 * - `sendMessage` makes one HTTP attempt. A claimed delivery can be retried
 *   after its lease only until agent ingress atomically fences it as live. Once
 *   live, completion or explicit reset is required; ambiguous redelivery would
 *   risk invoking Eve twice.
 * - Reactions and reset retry because they are naturally idempotent. HITL input
 *   retries with the same Discord interaction id; agent ingress receipts return
 *   the accepted acknowledgement or wedge the ambiguous admission window.
 */

import { context, isSpanContextValid, trace } from "@opentelemetry/api";
import { Transient, UpstreamError, httpStatusOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { noRetry, quickRetry } from "@repo/shared/result/retry";
import type { RetryPolicy } from "@repo/shared/result/retry";
import { WIRE_ROUTES } from "@repo/shared/wire";
import type {
  InteractionPayload,
  DeliveryPayload,
  ResetRequestPayload,
  WireResponse,
} from "@repo/shared/wire";

export type AgentError = Transient | UpstreamError;

export type AgentAck = Omit<Extract<WireResponse, { readonly ok: true }>, "ok">;

export type AgentFetch = (
  ...args: Parameters<typeof globalThis.fetch>
) => ReturnType<typeof globalThis.fetch>;

export interface AgentClientDeps {
  /** Base URL of the eve deployment, without a trailing slash. */
  readonly baseUrl: string;
  /** Bearer presented on every request. */
  readonly secret: string;
  /** Injected so tests and a dev harness need no network. */
  readonly fetch?: AgentFetch;
}

/**
 * Turns a non-2xx into a typed error.
 *
 * A 5xx is `Transient` and a 4xx is `UpstreamError`, which is what makes the
 * retry policies above mean anything: `isRetryable` keys on the tag, so the
 * classification decided here is the classification the retry loop obeys.
 */
async function errorFor(response: Response, operation: string): Promise<AgentError> {
  const body = await response.text().catch(() => "");
  const detail = body === "" ? response.statusText : body.slice(0, 512);

  return response.status >= 500
    ? new Transient({ operation, detail })
    : new UpstreamError({ service: "agent", status: response.status, detail });
}

function toAgentError(operation: string) {
  return (cause: unknown): AgentError => {
    // `errorFor` already classified anything that came back with a status, so
    // re-wrapping it here would discard that and make every failure look
    // retryable. Only genuinely untyped throws — a dropped socket, a DNS
    // failure, an aborted request — reach the fallback.
    if (cause instanceof Transient || cause instanceof UpstreamError) return cause;

    const status = httpStatusOf(cause);
    const detail = cause instanceof Error ? cause.message : String(cause);
    return status !== undefined && status < 500
      ? new UpstreamError({ service: "agent", status, detail })
      : new Transient({ operation, detail });
  };
}

function traceHeaders(explicit?: string): Readonly<Record<string, string>> {
  if (explicit !== undefined) return { traceparent: explicit };
  const span = trace.getSpan(context.active());
  if (span === undefined) return {};
  const spanContext = span.spanContext();
  if (!isSpanContextValid(spanContext)) return {};
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  return { traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-${flags}` };
}

function traceparentOf(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = Reflect.get(payload, "traceparent");
  return typeof value === "string" ? value : undefined;
}

export function createAgentClient(deps: AgentClientDeps) {
  const doFetch = deps.fetch ?? globalThis.fetch;

  const post = async <T>(
    route: string,
    payload: unknown,
    operation: string,
    policy: RetryPolicy<unknown>,
    decodeSuccess: (body: unknown, status: number) => T,
  ): Promise<Result<T, AgentError>> =>
    Result.tryPromise({
      try: async () => {
        const request = new Request(new URL(route, deps.baseUrl).toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${deps.secret}`,
            ...traceHeaders(traceparentOf(payload)),
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        const response = await doFetch(request);

        if (!response.ok) throw await errorFor(response, operation);

        const body: unknown = await response.json();
        if (isWireResponse(body) && !body.ok) {
          throw new UpstreamError({
            service: "agent",
            status: response.status,
            detail: `${body.tag}: ${body.message}`,
          });
        }
        return decodeSuccess(body, response.status);
      },
      catch: toAgentError(operation),
      ...policy,
    });

  return {
    /** Not retried — see the note at the top of this file. */
    sendMessage: async (payload: DeliveryPayload): Promise<Result<AgentAck, AgentError>> =>
      post(WIRE_ROUTES.message, payload, "agent.message", noRetry, decodeSessionAck),

    sendInteraction: async (payload: InteractionPayload): Promise<Result<AgentAck, AgentError>> =>
      post(WIRE_ROUTES.interaction, payload, "agent.interaction", quickRetry, decodeSessionAck),

    sendReset: async (payload: ResetRequestPayload): Promise<Result<undefined, AgentError>> =>
      post(WIRE_ROUTES.reset, payload, "agent.reset", quickRetry, decodeCommandAck),
  };
}

function invalidWireResponse(status: number): UpstreamError {
  return new UpstreamError({
    service: "agent",
    status,
    detail: "response did not match the wire contract",
  });
}

function decodeSessionAck(value: unknown, status: number): AgentAck {
  if (!isWireResponse(value) || !value.ok) throw invalidWireResponse(status);
  return { sessionId: value.sessionId, continuationToken: value.continuationToken };
}

function decodeCommandAck(value: unknown, status: number): undefined {
  if (typeof value !== "object" || value === null) throw invalidWireResponse(status);
  const candidate: Record<string, unknown> = { ...value };
  if (
    typeof candidate["ok"] !== "boolean" ||
    !candidate["ok"] ||
    (candidate["status"] !== undefined && typeof candidate["status"] !== "string")
  ) {
    throw invalidWireResponse(status);
  }
}

function isWireResponse(value: unknown): value is WireResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate: Record<string, unknown> = { ...value };
  const ok = candidate["ok"];
  if (typeof ok !== "boolean") return false;
  if (ok) {
    return (
      typeof candidate["sessionId"] === "string" &&
      candidate["sessionId"] !== "" &&
      typeof candidate["continuationToken"] === "string" &&
      candidate["continuationToken"] !== ""
    );
  }
  return typeof candidate["tag"] === "string" && typeof candidate["message"] === "string";
}

export type AgentClient = ReturnType<typeof createAgentClient>;
