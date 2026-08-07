/**
 * The bot's HTTP surface.
 *
 * Deliberately tiny. The bot is not a web service; this exists so a host can
 * tell whether the process is actually doing its job. One endpoint serves every
 * host we might use — a Fly or Railway liveness probe, a Docker `HEALTHCHECK`,
 * and the Vercel Sandbox supervisor that decides whether to replace the sandbox.
 *
 * The distinction that makes it useful: readiness means *the gateway is
 * connected*, not *the process is running*. A bot whose socket has dropped is
 * alive and useless, and a probe that only proved the process existed would
 * never restart it.
 */

import { bearerMatches } from "@repo/shared/bearer";
import { Result } from "@repo/shared/result";
import {
  BOT_ROUTES,
  decodeParkedPayload,
  decodeRenderWakePayload,
  decodeScheduledFirePayload,
} from "@repo/shared/wire";
import type { ScheduledFirePayload } from "@repo/shared/wire";
import type { Client } from "discord.js";

import {
  DISCORD_COMMAND_ROUTE,
  handleDiscordCommandRequest,
} from "../agent/discord-commands/route.ts";
import { onShutdown } from "./lifecycle.ts";
import { continueTrace, traceOperation } from "./observability.ts";

export interface HealthReport {
  readonly ready: boolean;
  /** Gateway round-trip in milliseconds. `-1` before the first heartbeat. */
  readonly websocketPingMs: number;
  readonly uptimeSeconds: number;
}

export function healthOf(
  client: Client,
  operationalReady = true,
  now: () => number = () => Date.now(),
): HealthReport {
  const ready = client.isReady() && operationalReady;
  const readyAt = client.readyTimestamp;
  const ping = client.ws.ping;
  return {
    ready,
    websocketPingMs: Number.isFinite(ping) ? Math.round(ping) : -1,
    // oxlint-disable-next-line unicorn/no-null -- discord.js reports "never ready" as null
    uptimeSeconds: ready && readyAt !== null ? Math.floor((now() - readyAt) / 1_000) : 0,
  };
}

export interface ConversationSink {
  readonly wake: (hint: {
    readonly dispatchId?: string;
    readonly continuationKey?: string;
  }) => void;
  readonly admitSchedule: (payload: ScheduledFirePayload) => Promise<void>;
}

export interface ServerDeps {
  readonly port: number;
  readonly client: Client;
  readonly conversations: ConversationSink;
  /** Bearer the agent must present on internal callbacks. */
  readonly ingressSecret: string;
  /** Final startup latch: recovery, handlers, and schedules must all be attached. */
  readonly operationalReady?: () => boolean;
}

/**
 * The routing table, as a pure function of a request.
 *
 * Split out from `Bun.serve` so the routing logic is a plain function of a
 * request and the runtime-specific server is one line.
 *
 * A not-ready gateway answers 503 so a probe treats it as failing. Returning 200
 * with `ready: false` would leave a wedged bot running indefinitely, since most
 * probes only look at the status code.
 */
async function handleRequestInTrace(request: Request, deps: ServerDeps): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === BOT_ROUTES.health) {
    const report = healthOf(deps.client, deps.operationalReady?.() ?? true);
    return Response.json(report, { status: report.ready ? 200 : 503 });
  }

  if (pathname === DISCORD_COMMAND_ROUTE) {
    return handleDiscordCommandRequest(request, deps);
  }
  if (pathname === BOT_ROUTES.parked) {
    return handleParked(request, deps);
  }
  if (pathname === BOT_ROUTES.render) {
    return handleRender(request, deps);
  }
  if (pathname === BOT_ROUTES.scheduled) {
    return handleScheduled(request, deps);
  }

  return new Response("not found", { status: 404 });
}

export async function handleRequest(request: Request, deps: ServerDeps): Promise<Response> {
  const traceparent = request.headers.get("traceparent") ?? undefined;
  if (traceparent === undefined) return handleRequestInTrace(request, deps);
  const pathname = new URL(request.url).pathname;
  return continueTrace(traceparent, () =>
    traceOperation("bot.internal.request", () => handleRequestInTrace(request, deps), {
      "http.request.method": request.method,
      "url.path": pathname,
    }),
  );
}

/**
 * The queue-release callback from the agent.
 *
 * It carries no render body. The router waits for the matching durable terminal
 * paint outcome before releasing the next queued turn. Answering 200 on a payload
 * we could not act on would be a lie, but answering 500 would invite the agent
 * to retry a callback that will never succeed, so a bad payload is a 400.
 */
async function handleParked(request: Request, deps: ServerDeps): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  if (!bearerMatches(request.headers.get("authorization") ?? undefined, deps.ingressSecret)) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await request.json().catch((): unknown => undefined);
  const decoded = decodeParkedPayload(body);
  if (Result.isError(decoded)) {
    return Response.json({ ok: false, issues: decoded.error.issues }, { status: 400 });
  }

  deps.conversations.wake({
    dispatchId: decoded.value.dispatchId,
    continuationKey: decoded.value.continuationKey,
  });
  return Response.json({ ok: true });
}

async function handleRender(request: Request, deps: ServerDeps): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!bearerMatches(request.headers.get("authorization") ?? undefined, deps.ingressSecret)) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await request.json().catch((): unknown => undefined);
  const decoded = decodeRenderWakePayload(body);
  if (Result.isError(decoded)) {
    return Response.json({ ok: false, issues: decoded.error.issues }, { status: 400 });
  }
  deps.conversations.wake({ dispatchId: decoded.value.dispatchId });
  return Response.json({ ok: true }, { status: 202 });
}

async function handleScheduled(request: Request, deps: ServerDeps): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!bearerMatches(request.headers.get("authorization") ?? undefined, deps.ingressSecret)) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await request.json().catch((): unknown => undefined);
  const decoded = decodeScheduledFirePayload(body);
  if (Result.isError(decoded)) {
    return Response.json({ ok: false, issues: decoded.error.issues }, { status: 400 });
  }

  try {
    await deps.conversations.admitSchedule(decoded.value);
    return Response.json({ ok: true }, { status: 202 });
  } catch (cause) {
    console.error("scheduled fire could not enter the agent router", cause);
    return Response.json(
      { ok: false, message: "scheduled fire was not accepted" },
      { status: 503 },
    );
  }
}

export interface RunningServer {
  /** The bound port. Differs from the requested one when asking for port 0. */
  readonly port: number;
  readonly stop: () => Promise<void>;
}

/** Starts the health server and registers its own shutdown. */
export function startServer(deps: ServerDeps): RunningServer {
  const server = Bun.serve({
    port: deps.port,
    fetch: (request) => handleRequest(request, deps),
  });

  const stop = async () => {
    await server.stop(true);
  };
  onShutdown("http-server", stop);

  // Bun types `port` as optional because a server can bind a unix socket; this
  // one always binds TCP, so the requested port is a sound fallback.
  const port = server.port ?? deps.port;
  console.info(`health server listening on :${port}${BOT_ROUTES.health}`);
  return { port, stop };
}
