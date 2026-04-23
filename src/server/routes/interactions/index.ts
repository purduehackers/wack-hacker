import { Hono, type Context } from "hono";

import type { DiscordInteraction } from "@/lib/protocol/types";

import { env } from "@/env";
import { countMetric, recordDuration } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";
import { InteractionType, InteractionResponseType } from "@/lib/protocol/constants";
import { verifyInteraction } from "@/lib/protocol/verify";

import type { DispatcherResult } from "./types.ts";

import { handleApplicationCommand } from "./command.ts";
import { handleMessageComponent } from "./component.ts";
import { handleModalSubmit } from "./modal.ts";

const route = new Hono();

route.post("/interactions", async (c) => {
  return withSpan(
    "interaction.dispatch",
    { "http.route": "/api/discord/interactions" },
    async () => {
      const startTime = Date.now();
      try {
        const result = await verifyInteraction(c.req.raw, env.DISCORD_BOT_PUBLIC_KEY);
        if (!result.valid) {
          countMetric("interaction.unauthorized");
          return c.json({ error: "Invalid signature" }, 401);
        }

        const interaction = result.body as DiscordInteraction;
        countMetric("interaction.received", { type: typeLabel(interaction.type) });

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
            countMetric("interaction.unknown_type");
            return c.json({ error: "Unhandled interaction type" }, 400);
        }
      } finally {
        recordDuration("interaction.dispatch_duration", Date.now() - startTime);
      }
    },
  );
});

function typeLabel(type: InteractionType): string {
  switch (type) {
    case InteractionType.Ping:
      return "ping";
    case InteractionType.ApplicationCommand:
      return "command";
    case InteractionType.MessageComponent:
      return "component";
    case InteractionType.ApplicationCommandAutocomplete:
      return "autocomplete";
    case InteractionType.ModalSubmit:
      return "modal";
  }
}

function dispatch(c: Context, result: DispatcherResult): Response {
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
}

export default route;
