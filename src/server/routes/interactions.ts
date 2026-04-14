import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { waitUntil } from "@vercel/functions";
import { log } from "evlog";
import { Hono } from "hono";

import type { SlashCommand } from "@/lib/bot/commands/types";
import type { ComponentHandler } from "@/lib/bot/components/types";
import type { DiscordInteraction } from "@/lib/protocol/types";

import { env } from "@/env";
import { parseOptions } from "@/lib/bot/commands/registry";
import * as components from "@/lib/bot/components";
import * as commands from "@/lib/bot/handlers/commands";
import { InteractionType, InteractionResponseType } from "@/lib/protocol/constants";
import { verifyInteraction } from "@/lib/protocol/verify";

const commandMap = new Map((Object.values(commands) as SlashCommand[]).map((c) => [c.name, c]));

const componentHandlers = Object.values(components).filter(
  (v) => !!v && typeof v === "object" && "prefix" in v,
) as ComponentHandler[];

const route = new Hono();

route.post("/interactions", async (c) => {
  const result = await verifyInteraction(c.req.raw, env.DISCORD_PUBLIC_KEY);
  if (!result.valid) return c.json({ error: "Invalid signature" }, 401);

  const interaction = result.body as DiscordInteraction;

  if (interaction.type === InteractionType.Ping) {
    return c.json({ type: InteractionResponseType.Pong });
  }

  if (interaction.type === InteractionType.ApplicationCommand) {
    const name = interaction.data?.name;
    if (!name) return c.json({ error: "Missing command name" }, 400);

    const command = commandMap.get(name);
    if (!command) {
      return c.json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: `Unknown command: /${name}` },
      });
    }

    log.info("interactions", `Executing /${name}`);

    const discord = new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN));
    waitUntil(
      command
        .execute({
          interaction,
          discord,
          options: parseOptions(interaction.data?.options),
        })
        .catch((err) => {
          log.error("interactions", `/${name} failed: ${err}`);
          discord.interactions
            .editReply(interaction.application_id, interaction.token, {
              content: `Error executing /${name}.`,
            })
            .catch((e) => log.error("interactions", `Failed to send error response: ${e}`));
        }),
    );

    return c.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
    });
  }

  if (interaction.type === InteractionType.MessageComponent) {
    const customId = interaction.data?.custom_id;
    if (!customId) return c.json({ error: "Missing custom_id" }, 400);

    const prefix = customId.split(":")[0];
    const handler = componentHandlers.find((h) => h.prefix === prefix);

    if (handler) {
      log.info("interactions", `Handling component ${prefix}`);
      const discord = new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN));
      waitUntil(
        handler.handle({ interaction, discord, customId }).catch((err) => {
          log.error("interactions", `Component ${customId} failed: ${err}`);
        }),
      );
    }

    return c.json({ type: InteractionResponseType.DeferredUpdateMessage });
  }

  // No slash commands currently declare autocomplete options; respond with an
  // empty choice list so Discord doesn't show a stale/broken suggestion popup.
  if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
    return c.json({
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: { choices: [] },
    });
  }

  // No commands currently show modals (would be returned via
  // `InteractionResponseType.Modal`), so a modal submission here means
  // something registered a modal we don't know how to handle.
  if (interaction.type === InteractionType.ModalSubmit) {
    log.warn("interactions", `Unexpected modal submit: ${interaction.data?.custom_id}`);
    return c.json({ error: "Modal submissions not supported" }, 400);
  }

  return c.json({ error: "Unhandled interaction type" }, 400);
});

export default route;
