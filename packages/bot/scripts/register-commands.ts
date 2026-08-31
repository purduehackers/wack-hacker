/** Explicit, guarded guild-command registration. Never runs during bot startup. */

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { httpStatusOf, messageOf, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { REST, Routes } from "discord.js";
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { z } from "zod";

import { builder as hackNight } from "../src/commands/hack-night.ts";
import { builder as imageDrop } from "../src/commands/image-drop.ts";
import { ping } from "../src/commands/ping.ts";
import { builder as privacy } from "../src/commands/privacy.ts";

/**
 * Only the two variables this script needs.
 *
 * `src/env.ts` validates the bot's *whole* environment, which this script does
 * not have and must not require: registering commands needs a token and an
 * application id, not a Groq key.
 *
 * Untrimmed, for the same reason `src/env.ts` leaves a credential untrimmed:
 * the value presented to Discord is the value that was configured.
 */
const credentialsSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_BOT_CLIENT_ID: z.string().min(1),
});

const registrationBody: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  ping.builder.toJSON(),
  privacy.toJSON(),
  hackNight.toJSON(),
  imageDrop.toJSON(),
];

async function registerCommands(deps: {
  readonly token: string;
  readonly applicationId: string;
  readonly guildId: string;
  readonly body: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[];
}): Promise<Result<number, UpstreamError>> {
  const rest = new REST({ version: "10" }).setToken(deps.token);
  return Result.tryPromise({
    try: async () => {
      await rest.put(Routes.applicationGuildCommands(deps.applicationId, deps.guildId), {
        body: deps.body,
      });
      return deps.body.length;
    },
    catch: (cause) =>
      new UpstreamError({
        service: "discord",
        status: httpStatusOf(cause) ?? 0,
        detail: messageOf(cause),
      }),
  });
}

async function main(): Promise<void> {
  if (process.env["CONFIRM_COMMAND_GUILD"] !== DISCORD_GUILD_ID) {
    console.error(`refusing command registration: set CONFIRM_COMMAND_GUILD=${DISCORD_GUILD_ID}`);
    process.exitCode = 1;
    return;
  }
  const credentials = credentialsSchema.safeParse(process.env);
  if (!credentials.success) {
    console.error("DISCORD_BOT_TOKEN and DISCORD_BOT_CLIENT_ID are required");
    process.exitCode = 1;
    return;
  }

  const outcome = await registerCommands({
    token: credentials.data.DISCORD_BOT_TOKEN,
    applicationId: credentials.data.DISCORD_BOT_CLIENT_ID,
    guildId: DISCORD_GUILD_ID,
    body: registrationBody,
  });
  if (Result.isError(outcome)) {
    console.error(`command registration failed: ${messageOf(outcome.error)}`);
    process.exitCode = 1;
    return;
  }
  console.info(`registered ${outcome.value} command(s) to guild ${DISCORD_GUILD_ID}`);
}

if (import.meta.main) await main();
