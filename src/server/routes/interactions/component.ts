import { waitUntil } from "@vercel/functions";

import type { ComponentHandler } from "@/bot/components/types";
import type { DiscordInteraction } from "@/lib/protocol/types";

import * as components from "@/bot/components";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { runInstrumented } from "@/lib/otel/instrumented";
import { captureTraceparent } from "@/lib/otel/tracing";
import { InteractionResponseType } from "@/lib/protocol/constants";

import type { DispatcherResult } from "./types.ts";

import { buildDiscord, ephemeralError } from "./shared.ts";

const componentHandlers = Object.values(components).filter(
  (v) => !!v && typeof v === "object" && "prefix" in v,
) as ComponentHandler[];

export function handleMessageComponent(interaction: DiscordInteraction): DispatcherResult {
  const customId = interaction.data?.custom_id;
  if (!customId) return { error: "Missing custom_id", status: 400 };

  const prefix = customId.split(":")[0] ?? "unknown";
  const handler = componentHandlers.find((h) => h.prefix === prefix);

  if (!handler) {
    // A custom_id with no registered handler means the component outlived its
    // code (a deploy removed the prefix) or the id is corrupt. Acking with a
    // deferred update would leave the user clicking a button that silently
    // does nothing — tell them instead.
    countMetric("interaction.component_unknown", { prefix });
    createWideLogger({
      op: "interaction.component",
      component: { prefix, custom_id: customId },
    }).emit({ outcome: "unknown" });
    return ephemeralError("This button is no longer active.");
  }

  countMetric("interaction.component", { prefix });
  const discord = buildDiscord();
  const startTime = Date.now();
  // Capture the interaction trace synchronously (we're still inside the route's
  // span here) so the deferred handler — which runs in waitUntil after the ack —
  // stays in the same trace instead of starting a detached root.
  const traceparent = captureTraceparent();
  waitUntil(
    (async () => {
      try {
        await runInstrumented(
          {
            op: "interaction.component",
            traceparent,
            spanAttrs: { "component.prefix": prefix },
            loggerContext: {
              component: { prefix, custom_id: customId },
              user: { id: interaction.member?.user?.id ?? interaction.user?.id },
            },
          },
          async () => {
            await handler.handle({ interaction, discord, customId });
          },
        );
      } catch {
        // runInstrumented already captured the error to Sentry; this catch only
        // counts the metric and absorbs the rejection so it isn't an unhandled
        // rejection inside waitUntil. Do NOT add another capture here.
        countMetric("interaction.component_error", { prefix });
      } finally {
        recordDuration("interaction.component_duration", Date.now() - startTime, { prefix });
      }
    })(),
  );

  return { type: InteractionResponseType.DeferredUpdateMessage };
}
