/**
 * The bot's HTTP client for the agent.
 *
 * Three calls, one per route on the agent's custom Discord channel. Everything
 * the bot knows about the agent is here and in `@repo/shared/wire`.
 *
 * The retry policy differs per route on purpose, and the distinction is
 * correctness rather than tuning:
 *
 * - `sendMessage` makes one HTTP attempt. A claimed delivery can be retried
 *   after its lease only until agent ingress atomically fences it as live. Once
 *   live, completion or explicit reset is required; ambiguous redelivery would
 *   risk invoking Eve twice.
 * - Reset retries because it is naturally idempotent. HITL input retries with
 *   the same Discord interaction id; agent ingress receipts return the accepted
 *   acknowledgement or wedge the ambiguous admission window.
 */

import { Transient, UpstreamError, httpStatusOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { noRetry, quickRetry } from "@repo/shared/result/retry";
import type { RetryPolicy } from "@repo/shared/result/retry";
import { WIRE_ROUTES, wireResponseSchema } from "@repo/shared/wire";
import type {
  InteractionPayload,
  DeliveryPayload,
  ResetRequestPayload,
  SteerRequestPayload,
  WireResponse,
} from "@repo/shared/wire";
import { z } from "zod";

import { activeTraceparent } from "../framework/observability.ts";

export type AgentError = Transient | UpstreamError;

/** Every body this client posts. Only the reset route carries no trace context. */
type AgentRequestPayload =
  | DeliveryPayload
  | InteractionPayload
  | ResetRequestPayload
  | SteerRequestPayload;

type AgentAck = Omit<Extract<WireResponse, { readonly ok: true }>, "ok">;

interface AgentClientDeps {
  /** Base URL of the eve deployment, without a trailing slash. */
  readonly baseUrl: string;
  /** Bearer presented on every request. */
  readonly secret: string;
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

/** The payload's own parent when it carries one, otherwise the active span's. */
function traceHeaders(explicit?: string): Readonly<Record<string, string>> {
  const traceparent = explicit ?? activeTraceparent();
  return traceparent === undefined ? {} : { traceparent };
}

function traceparentOf(payload: AgentRequestPayload): string | undefined {
  return "traceparent" in payload ? payload.traceparent : undefined;
}

export function createAgentClient(deps: AgentClientDeps) {
  const post = async <T>(
    route: string,
    payload: AgentRequestPayload,
    operation: string,
    policy: RetryPolicy<AgentError>,
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
        const response = await globalThis.fetch(request);

        if (!response.ok) throw await errorFor(response, operation);

        const body: unknown = await response.json();
        const wire = wireResponseSchema.safeParse(body);
        if (wire.success && !wire.data.ok) {
          throw new UpstreamError({
            service: "agent",
            status: response.status,
            detail: `${wire.data.tag}: ${wire.data.message}`,
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

    sendSteer: async (payload: SteerRequestPayload): Promise<Result<undefined, AgentError>> =>
      post(WIRE_ROUTES.steer, payload, "agent.steer", quickRetry, decodeCommandAck),
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
  const parsed = wireResponseSchema.safeParse(value);
  if (!parsed.success || !parsed.data.ok) throw invalidWireResponse(status);
  return { sessionId: parsed.data.sessionId, continuationToken: parsed.data.continuationToken };
}

/**
 * The reset route's acknowledgement: `ok: true`, with an advisory status.
 *
 * Not `wireResponseSchema` — the reset route answers with a status string in
 * place of the session pair, so it is a different body on the same route family.
 */
const commandAckSchema = z.object({ ok: z.literal(true), status: z.string().optional() });

function decodeCommandAck(value: unknown, status: number): undefined {
  if (!commandAckSchema.safeParse(value).success) throw invalidWireResponse(status);
}

export type AgentClient = ReturnType<typeof createAgentClient>;
