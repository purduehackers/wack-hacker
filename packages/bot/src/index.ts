/**
 * Bot entry point.
 *
 * Boot order matters. The gateway comes up first and readiness is awaited, so a
 * bad token fails the process immediately rather than leaving a bot that is
 * running and receiving nothing. Only then does the health server start, which
 * means the endpoint can never report ready before the socket is.
 */

import { serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { Events } from "discord.js";

import { dispatchInteraction } from "./commands/dispatch.ts";
import { COMMANDS } from "./commands/index.ts";
import { env } from "./env.ts";
import { connect, createClient } from "./gateway.ts";
import { installSignalHandlers, shutdown } from "./lifecycle.ts";
import { consoleReporter } from "./observability.ts";
import { startServer } from "./server.ts";

async function main(): Promise<void> {
  installSignalHandlers();

  const client = createClient();

  client.on(Events.InteractionCreate, (interaction) => {
    // discord.js does not await listeners, so the promise is handled here or a
    // rejection is lost. `dispatchInteraction` is written never to reject.
    void dispatchInteraction(interaction, { commands: COMMANDS, reporter: consoleReporter });
  });

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
    `logged in as ${connected.value.user.tag} with ${COMMANDS.length} command handler(s)`,
  );

  startServer({ port: env.PORT, client: connected.value });
}

await main();
