import { waitUntil } from "@vercel/functions";
import { log } from "evlog";

import type { InteractionResponsePayload, SlashCommand } from "@/bot/commands/types";
import type { DiscordInteraction } from "@/lib/protocol/types";

import { parseOptions } from "@/bot/commands/registry";
import * as commands from "@/bot/handlers/commands";
import { countMetric } from "@/lib/metrics";
import { InteractionResponseType } from "@/lib/protocol/constants";

import type { DispatcherResult } from "./types.ts";

import { EPHEMERAL_FLAG } from "./constants.ts";
import { buildDiscord, describeError, ephemeralError } from "./shared.ts";

const commandMap = new Map((Object.values(commands) as SlashCommand[]).map((c) => [c.name, c]));

export async function handleApplicationCommand(
  interaction: DiscordInteraction,
): Promise<DispatcherResult> {
  const name = interaction.data?.name;
  if (!name) return { error: "Missing command name", status: 400 };

  const command = commandMap.get(name);
  if (!command) {
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: `Unknown command: /${name}` },
    };
  }

  log.info("interactions", `Executing /${name}`);
  countMetric("interaction.command", { command: name });

  if (command.modal) return runModalCommand(command, interaction);
  return runDeferredCommand(command, interaction);
}

async function runModalCommand(
  command: SlashCommand,
  interaction: DiscordInteraction,
): Promise<InteractionResponsePayload> {
  const discord = buildDiscord();
  try {
    const response = await command.execute({
      interaction,
      discord,
      options: parseOptions(interaction.data?.options),
    });
    if (response) return response;
    log.error("interactions", `/${command.name} (modal) returned no response`);
    countMetric("interaction.command_error", { command: command.name });
    return ephemeralError(`/${command.name} did not produce a response.`);
  } catch (err) {
    log.error("interactions", `/${command.name} failed: ${describeError(err)}`);
    countMetric("interaction.command_error", { command: command.name });
    return ephemeralError(`Error executing /${command.name}.`);
  }
}

function runDeferredCommand(
  command: SlashCommand,
  interaction: DiscordInteraction,
): InteractionResponsePayload {
  const discord = buildDiscord();
  waitUntil(
    command
      .execute({
        interaction,
        discord,
        options: parseOptions(interaction.data?.options),
      })
      .catch((err: unknown) => {
        log.error("interactions", `/${command.name} failed: ${describeError(err)}`);
        countMetric("interaction.command_error", { command: command.name });
        discord.interactions
          .editReply(interaction.application_id, interaction.token, {
            content: `Error executing /${command.name}.`,
          })
          .catch((e: unknown) =>
            log.error("interactions", `Failed to send error response: ${describeError(e)}`),
          );
      }),
  );
  return {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: command.ephemeral ? { flags: EPHEMERAL_FLAG } : undefined,
  };
}
