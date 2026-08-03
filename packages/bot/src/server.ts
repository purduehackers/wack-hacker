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

import { BOT_ROUTES } from "@repo/shared/wire";
import type { Client } from "discord.js";

import { onShutdown } from "./lifecycle.ts";

export interface HealthReport {
  readonly ready: boolean;
  /** Gateway round-trip in milliseconds. `-1` before the first heartbeat. */
  readonly websocketPingMs: number;
  readonly uptimeSeconds: number;
}

export function healthOf(client: Client, now: () => number = () => Date.now()): HealthReport {
  const readyAt = client.readyTimestamp;
  return {
    // oxlint-disable-next-line unicorn/no-null -- discord.js reports "not ready" as null
    ready: readyAt !== null,
    websocketPingMs: Math.round(client.ws.ping),
    // oxlint-disable-next-line unicorn/no-null -- same discord.js contract
    uptimeSeconds: readyAt === null ? 0 : Math.floor((now() - readyAt) / 1_000),
  };
}

export interface ServerDeps {
  readonly port: number;
  readonly client: Client;
}

/**
 * Starts the health server and registers its own shutdown.
 *
 * A not-ready gateway answers 503 so a probe treats it as failing. Returning 200
 * with `ready: false` would leave a wedged bot running indefinitely, since most
 * probes only look at the status code.
 */
export function startServer(deps: ServerDeps): { readonly stop: () => Promise<void> } {
  const server = Bun.serve({
    port: deps.port,
    fetch: (request) => {
      const { pathname } = new URL(request.url);

      if (pathname === BOT_ROUTES.health) {
        const report = healthOf(deps.client);
        return Response.json(report, { status: report.ready ? 200 : 503 });
      }

      return new Response("not found", { status: 404 });
    },
  });

  const stop = async () => {
    await server.stop(true);
  };
  onShutdown("http-server", stop);

  console.info(`health server listening on :${deps.port}${BOT_ROUTES.health}`);
  return { stop };
}
