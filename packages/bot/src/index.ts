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
 */

import { serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { Events } from "discord.js";

import { dispatchInteraction } from "./commands/dispatch.ts";
import { buildCommands } from "./commands/index.ts";
import { env } from "./env.ts";
import { connect, createClient } from "./gateway.ts";
import { installSignalHandlers, shutdown } from "./lifecycle.ts";
import { consoleReporter } from "./observability.ts";
import { startServer } from "./server.ts";

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

  console.info(
    `logged in as ${connected.value.user.tag} with ${commands.length} command handler(s)`,
  );
}

await main();
