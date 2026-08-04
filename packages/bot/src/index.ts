/**
 * Bot entry point.
 *
 * Boot order matters, in both directions.
 *
 * The health server binds *first*, so a supervisor polling `/health` during a
 * slow or failing login gets a structured 503 rather than a refused connection.
 * Readiness stays honest regardless of order, because it is derived from the
 * gateway's own `readyTimestamp` rather than from a flag set at startup.
 *
 * Login readiness is then *awaited*, so a bad token aborts the process instead
 * of leaving a bot that is running and receiving nothing. Exiting is deliberate:
 * every host this runs on restarts a failed container with backoff, which is a
 * better outcome than a live process that silently does nothing.
 *
 * Event handlers and schedules attach only *after* readiness, because both need
 * a `Client<true>` — and because a schedule firing mid-login would act on a
 * gateway that cannot yet send anything.
 */

import { serializeError } from "@repo/shared/errors";
import { getRedis } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { Events } from "discord.js";

import { buildCommands } from "./commands/index.ts";
import { env } from "./env.ts";
import { buildEventHandlers } from "./events/index.ts";
import { createDeduplicator } from "./framework/dedup.ts";
import { dispatchInteraction } from "./framework/dispatch.ts";
import { attachEventRouter } from "./framework/events.ts";
import { connect, createClient } from "./framework/gateway.ts";
import { installSignalHandlers, onShutdown, shutdown } from "./framework/lifecycle.ts";
import { consoleReporter } from "./framework/observability.ts";
import { startScheduler } from "./framework/schedules.ts";
import { startServer } from "./framework/server.ts";
import { buildSchedules } from "./schedules/index.ts";

async function main(): Promise<void> {
  installSignalHandlers();

  const client = createClient();
  const built = buildCommands({
    privacyApiKey: env.PRIVACY_DB_API_KEY,
    vercelToken: env.VERCEL_API_TOKEN,
    dashboardEdgeConfig: env.DASHBOARD_EDGE_CONFIG,
  });
  if (Result.isError(built)) {
    console.error(`startup aborted: ${serializeError(built.error).message}`);
    process.exit(1);
  }
  const commands = built.value;

  client.on(Events.InteractionCreate, (interaction) => {
    // discord.js does not await listeners, so the promise is handled here or a
    // rejection is lost. `dispatchInteraction` is written never to reject.
    void dispatchInteraction(interaction, { commands, reporter: consoleReporter });
  });

  // Reports ready: false until the gateway connects.
  startServer({ port: env.PORT, client });

  const connected = await connect(client, {
    token: env.DISCORD_BOT_TOKEN,
    onError: (error, context) => consoleReporter.captureDefect(error, context),
  });

  if (Result.isError(connected)) {
    console.error(`startup aborted: ${serializeError(connected.error).message}`);
    await shutdown("startup-failure");
    process.exit(1);
  }

  const ready = connected.value;

  // One client, shared by dedup and the hack night slug store.
  const redis = getRedis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  const handlers = buildEventHandlers({
    redis,
    cmsApiKey: env.PAYLOAD_CMS_API_KEY,
    shipApiKey: env.SHIP_API_KEY,
    dashboardApiToken: env.PHACK_API_TOKEN,
    groqApiKey: env.GROQ_API_KEY,
  });
  attachEventRouter(ready, {
    handlers,
    reporter: consoleReporter,
    dedup: createDeduplicator(redis),
  });

  const scheduler = startScheduler({
    schedules: buildSchedules({ redis, cmsApiKey: env.PAYLOAD_CMS_API_KEY }),
    client: ready,
    reporter: consoleReporter,
  });
  onShutdown("scheduler", () => scheduler.stop());

  const upcoming = [...scheduler.nextRuns]
    .map(([name, next]) => `${name}=${next?.toISOString() ?? "never"}`)
    .join(" ");

  console.info(`logged in as ${ready.user.tag}`);
  console.info(
    `${commands.length} command(s), ${handlers.length} event handler(s), ` +
      `${scheduler.nextRuns.size} schedule(s)${upcoming === "" ? "" : `: ${upcoming}`}`,
  );
}

await main();
