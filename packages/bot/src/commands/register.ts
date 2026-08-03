/**
 * Registers slash commands with Discord.
 *
 * Guild-scoped, not global: the bot serves one guild, and guild commands appear
 * immediately while global commands can take up to an hour to propagate.
 *
 * `PUT` replaces the whole set, which makes this idempotent and also means a
 * command removed from `COMMANDS` disappears from Discord on the next run —
 * that is intended, and the reason the registry is an explicit list.
 *
 * Run separately from process start. The legacy app registered during its build
 * so a broken build could never touch the live bot; the same reasoning applies
 * here, which is why `bun run src/index.ts` does not do this implicitly.
 */

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { UpstreamError, httpStatusOf, serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { REST, Routes } from "discord.js";

import { env } from "../env.ts";
import { toRegistrationBody } from "./define.ts";
import type { SlashCommand } from "./define.ts";
import { buildCommands } from "./index.ts";

export async function registerCommands(deps: {
  readonly token: string;
  readonly applicationId: string;
  readonly guildId: string;
  readonly commands: readonly SlashCommand[];
}): Promise<Result<number, UpstreamError>> {
  const rest = new REST({ version: "10" }).setToken(deps.token);
  const body = deps.commands.map(toRegistrationBody);

  return Result.tryPromise({
    try: async () => {
      await rest.put(Routes.applicationGuildCommands(deps.applicationId, deps.guildId), { body });
      return body.length;
    },
    catch: (cause) =>
      new UpstreamError({
        service: "discord",
        status: httpStatusOf(cause) ?? 0,
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  });
}

const built = buildCommands({
  privacyApiKey: env.PRIVACY_DB_API_KEY,
  vercelToken: env.VERCEL_API_TOKEN,
  dashboardEdgeConfig: env.DASHBOARD_EDGE_CONFIG,
});

if (Result.isError(built)) {
  console.error(`cannot build commands: ${serializeError(built.error).message}`);
  process.exit(1);
}

const outcome = await registerCommands({
  token: env.DISCORD_BOT_TOKEN,
  applicationId: env.DISCORD_BOT_CLIENT_ID,
  guildId: DISCORD_GUILD_ID,
  commands: built.value,
});

if (Result.isError(outcome)) {
  console.error(`command registration failed: ${serializeError(outcome.error).message}`);
  process.exit(1);
}

console.info(`registered ${outcome.value} command(s) to guild ${DISCORD_GUILD_ID}`);
