/** Explicit, guarded guild-command registration. Never runs during bot startup. */

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { UpstreamError, httpStatusOf, serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { REST, Routes } from "discord.js";
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

import { builder as hackNight } from "../commands/hack-night.ts";
import { ping } from "../commands/ping.ts";
import { builder as privacy } from "../commands/privacy.ts";

export const registrationBody: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  ping.builder.toJSON(),
  privacy.toJSON(),
  hackNight.toJSON(),
];

export async function registerCommands(deps: {
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
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  });
}

async function main(): Promise<void> {
  if (process.env["CONFIRM_COMMAND_GUILD"] !== DISCORD_GUILD_ID) {
    console.error(`refusing command registration: set CONFIRM_COMMAND_GUILD=${DISCORD_GUILD_ID}`);
    process.exitCode = 1;
    return;
  }
  const token = process.env["DISCORD_BOT_TOKEN"];
  const applicationId = process.env["DISCORD_BOT_CLIENT_ID"];
  if (!token || !applicationId) {
    console.error("DISCORD_BOT_TOKEN and DISCORD_BOT_CLIENT_ID are required");
    process.exitCode = 1;
    return;
  }

  const outcome = await registerCommands({
    token,
    applicationId,
    guildId: DISCORD_GUILD_ID,
    body: registrationBody,
  });
  if (Result.isError(outcome)) {
    console.error(`command registration failed: ${serializeError(outcome.error).message}`);
    process.exitCode = 1;
    return;
  }
  console.info(`registered ${outcome.value} command(s) to guild ${DISCORD_GUILD_ID}`);
}

if (import.meta.main) await main();
