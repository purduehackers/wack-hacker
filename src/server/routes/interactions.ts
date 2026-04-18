import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { waitUntil } from "@vercel/functions";
import { log } from "evlog";
import { Hono } from "hono";

import type { SlashCommand } from "@/bot/commands/types";
import type { ComponentHandler } from "@/bot/components/types";
import type { ModalHandler } from "@/bot/modals/types";
import type { DiscordInteraction } from "@/lib/protocol/types";

import { parseOptions } from "@/bot/commands/registry";
import * as components from "@/bot/components";
import * as commands from "@/bot/handlers/commands";
import * as modalHandlers from "@/bot/handlers/modals";
import { env } from "@/env";
import { countMetric } from "@/lib/metrics";
import { InteractionType, InteractionResponseType } from "@/lib/protocol/constants";
import { verifyInteraction } from "@/lib/protocol/verify";

const EPHEMERAL_FLAG = 64;

const commandMap = new Map((Object.values(commands) as SlashCommand[]).map((c) => [c.name, c]));

const componentHandlers = Object.values(components).filter(
  (v) => !!v && typeof v === "object" && "prefix" in v,
) as ComponentHandler[];

const modalHandlerList = Object.values(modalHandlers).filter(
  (v) => !!v && typeof v === "object" && "prefix" in v,
) as ModalHandler[];

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

function buildDiscord(): API {
  return new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN));
}

async function runModalCommand(command: SlashCommand, interaction: DiscordInteraction) {
  const discord = buildDiscord();
  try {
    const response = await command.execute({
      interaction,
      discord,
      options: parseOptions(interaction.data?.options),
    });
    if (!response) {
      log.error("interactions", `/${command.name} (modal) returned no response`);
      countMetric("interaction.command_error", { command: command.name });
      return {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: `/${command.name} did not produce a response.`, flags: EPHEMERAL_FLAG },
      };
    }
    return response;
  } catch (err) {
    log.error("interactions", `/${command.name} failed: ${describeError(err)}`);
    countMetric("interaction.command_error", { command: command.name });
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: `Error executing /${command.name}.`, flags: EPHEMERAL_FLAG },
    };
  }
}

function runDeferredCommand(command: SlashCommand, interaction: DiscordInteraction) {
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

async function handleApplicationCommand(interaction: DiscordInteraction) {
  const name = interaction.data?.name;
  if (!name) return { error: "Missing command name" as const, status: 400 as const };

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

function handleMessageComponent(interaction: DiscordInteraction) {
  const customId = interaction.data?.custom_id;
  if (!customId) return { error: "Missing custom_id" as const, status: 400 as const };

  const prefix = customId.split(":")[0];
  const handler = componentHandlers.find((h) => h.prefix === prefix);

  if (handler) {
    log.info("interactions", `Handling component ${prefix}`);
    countMetric("interaction.component", { prefix });
    const discord = buildDiscord();
    waitUntil(
      handler.handle({ interaction, discord, customId }).catch((err: unknown) => {
        log.error("interactions", `Component ${customId} failed: ${describeError(err)}`);
      }),
    );
  }

  return { type: InteractionResponseType.DeferredUpdateMessage };
}

function extractModalFields(interaction: DiscordInteraction): Map<string, string> {
  const fields = new Map<string, string>();
  for (const row of interaction.data?.components ?? []) {
    for (const comp of row.components ?? []) {
      if (comp.custom_id) fields.set(comp.custom_id, comp.value ?? "");
    }
  }
  return fields;
}

async function handleModalSubmit(interaction: DiscordInteraction) {
  const customId = interaction.data?.custom_id;
  if (!customId) return { error: "Missing custom_id" as const, status: 400 as const };

  const prefix = customId.split(":")[0];
  const handler = modalHandlerList.find((h) => h.prefix === prefix);

  if (!handler) {
    log.warn("interactions", `Unexpected modal submit: ${customId}`);
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: "This form is no longer supported.", flags: EPHEMERAL_FLAG },
    };
  }

  log.info("interactions", `Handling modal ${prefix}`);
  countMetric("interaction.modal", { prefix });

  const discord = buildDiscord();
  try {
    return await handler.handle({
      interaction,
      discord,
      customId,
      fields: extractModalFields(interaction),
    });
  } catch (err: unknown) {
    log.error("interactions", `Modal ${customId} failed: ${describeError(err)}`);
    countMetric("interaction.modal_error", { prefix });
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { content: "Something went wrong processing the form.", flags: EPHEMERAL_FLAG },
    };
  }
}

const route = new Hono();

route.post("/interactions", async (c) => {
  const result = await verifyInteraction(c.req.raw, env.DISCORD_PUBLIC_KEY);
  if (!result.valid) return c.json({ error: "Invalid signature" }, 401);

  const interaction = result.body as DiscordInteraction;

  if (interaction.type === InteractionType.Ping) {
    return c.json({ type: InteractionResponseType.Pong });
  }

  if (interaction.type === InteractionType.ApplicationCommand) {
    const response = await handleApplicationCommand(interaction);
    if ("error" in response) return c.json({ error: response.error }, response.status);
    return c.json(response);
  }

  if (interaction.type === InteractionType.MessageComponent) {
    const response = handleMessageComponent(interaction);
    if ("error" in response) return c.json({ error: response.error }, response.status);
    return c.json(response);
  }

  // No slash commands currently declare autocomplete options; respond with an
  // empty choice list so Discord doesn't show a stale/broken suggestion popup.
  if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
    return c.json({
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    });
  }

  if (interaction.type === InteractionType.ModalSubmit) {
    const response = await handleModalSubmit(interaction);
    if ("error" in response) return c.json({ error: response.error }, response.status);
    return c.json(response);
  }

  return c.json({ error: "Unhandled interaction type" }, 400);
});

export default route;
