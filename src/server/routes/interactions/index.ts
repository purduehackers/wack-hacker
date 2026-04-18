import { Hono, type Context } from "hono";

import type { DiscordInteraction } from "@/lib/protocol/types";

import { env } from "@/env";
import { InteractionType, InteractionResponseType } from "@/lib/protocol/constants";
import { verifyInteraction } from "@/lib/protocol/verify";

import type { DispatcherResult } from "./types.ts";

import { handleApplicationCommand } from "./command.ts";
import { handleMessageComponent } from "./component.ts";
import { handleModalSubmit } from "./modal.ts";

const route = new Hono();

route.post("/interactions", async (c) => {
  const result = await verifyInteraction(c.req.raw, env.DISCORD_PUBLIC_KEY);
  if (!result.valid) return c.json({ error: "Invalid signature" }, 401);

  const interaction = result.body as DiscordInteraction;

  switch (interaction.type) {
    case InteractionType.Ping:
      return c.json({ type: InteractionResponseType.Pong });

    case InteractionType.ApplicationCommand:
      return dispatch(c, await handleApplicationCommand(interaction));

    case InteractionType.MessageComponent:
      return dispatch(c, handleMessageComponent(interaction));

    // No slash commands currently declare autocomplete options; respond with an
    // empty choice list so Discord doesn't show a stale/broken suggestion popup.
    case InteractionType.ApplicationCommandAutocomplete:
      return c.json({
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: { choices: [] },
      });

    case InteractionType.ModalSubmit:
      return dispatch(c, await handleModalSubmit(interaction));

    default:
      return c.json({ error: "Unhandled interaction type" }, 400);
  }
});

function dispatch(c: Context, result: DispatcherResult): Response {
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
}

export default route;
