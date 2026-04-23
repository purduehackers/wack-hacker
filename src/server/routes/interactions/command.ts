import { API } from "@discordjs/core/http-only";
import { waitUntil } from "@vercel/functions";

import type {
  InteractionResponsePayload,
  SlashCommand,
  SlashCommandContext,
} from "@/bot/commands/types";
import type { DiscordInteraction } from "@/lib/protocol/types";

import { parseOptions } from "@/bot/commands/registry";
import * as commands from "@/bot/handlers/commands";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";
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

  countMetric("interaction.command", { command: name });

  if (command.modal) return runModalCommand(command, interaction);
  return runDeferredCommand(command, interaction);
}

function buildCtx(interaction: DiscordInteraction, discord: API): SlashCommandContext {
  return { interaction, discord, options: parseOptions(interaction.data?.options) };
}

async function runModalCommand(
  command: SlashCommand,
  interaction: DiscordInteraction,
): Promise<InteractionResponsePayload> {
  return withSpan(
    "interaction.command",
    { "command.name": command.name, "command.mode": "modal" },
    async () => {
      const logger = createWideLogger({
        op: "interaction.command",
        command: { name: command.name, mode: "modal" },
        user: { id: interaction.member?.user?.id ?? interaction.user?.id },
      });
      const startTime = Date.now();
      const discord = buildDiscord();
      try {
        const response = await command.execute(buildCtx(interaction, discord));
        if (response) {
          logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
          return response;
        }
        countMetric("interaction.command_error", { command: command.name });
        logger.emit({
          outcome: "error",
          duration_ms: Date.now() - startTime,
          reason: "no_response",
        });
        return ephemeralError(`/${command.name} did not produce a response.`);
      } catch (err) {
        countMetric("interaction.command_error", { command: command.name });
        logger.error(err as Error);
        logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
        return ephemeralError(`Error executing /${command.name}.`);
      } finally {
        recordDuration("interaction.command_duration", Date.now() - startTime, {
          command: command.name,
          mode: "modal",
        });
      }
    },
  );
}

function runDeferredCommand(
  command: SlashCommand,
  interaction: DiscordInteraction,
): InteractionResponsePayload {
  const discord = buildDiscord();
  waitUntil(
    withSpan(
      "interaction.command",
      { "command.name": command.name, "command.mode": "deferred" },
      async () => {
        const logger = createWideLogger({
          op: "interaction.command",
          command: { name: command.name, mode: "deferred" },
          user: { id: interaction.member?.user?.id ?? interaction.user?.id },
        });
        const startTime = Date.now();
        try {
          await command.execute(buildCtx(interaction, discord));
          logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
        } catch (err) {
          countMetric("interaction.command_error", { command: command.name });
          logger.error(err as Error);
          logger.emit({
            outcome: "error",
            duration_ms: Date.now() - startTime,
            error_summary: describeError(err),
          });
          await discord.interactions
            .editReply(interaction.application_id, interaction.token, {
              content: `Error executing /${command.name}.`,
            })
            .catch((e: unknown) =>
              createWideLogger({
                op: "interaction.command.error_reply",
                command: { name: command.name },
              }).error(e as Error),
            );
        } finally {
          recordDuration("interaction.command_duration", Date.now() - startTime, {
            command: command.name,
            mode: "deferred",
          });
        }
      },
    ),
  );
  return {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: command.ephemeral ? { flags: EPHEMERAL_FLAG } : undefined,
  };
}
