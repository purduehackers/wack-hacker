import { waitUntil } from "@vercel/functions";

import type { ComponentHandler } from "@/bot/components/types";
import type { DiscordInteraction } from "@/lib/protocol/types";

import * as components from "@/bot/components";
import { countMetric, recordDuration } from "@/lib/metrics";
import { runInstrumented } from "@/lib/otel/instrumented";
import { InteractionResponseType } from "@/lib/protocol/constants";

import type { DispatcherResult } from "./types.ts";

import { buildDiscord } from "./shared.ts";

const componentHandlers = Object.values(components).filter(
  (v) => !!v && typeof v === "object" && "prefix" in v,
) as ComponentHandler[];

export function handleMessageComponent(interaction: DiscordInteraction): DispatcherResult {
  const customId = interaction.data?.custom_id;
  if (!customId) return { error: "Missing custom_id", status: 400 };

  const prefix = customId.split(":")[0] ?? "unknown";
  const handler = componentHandlers.find((h) => h.prefix === prefix);

  if (handler) {
    countMetric("interaction.component", { prefix });
    const discord = buildDiscord();
    const startTime = Date.now();
    waitUntil(
      (async () => {
        try {
          await runInstrumented(
            {
              op: "interaction.component",
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
          countMetric("interaction.component_error", { prefix });
        } finally {
          recordDuration("interaction.component_duration", Date.now() - startTime, { prefix });
        }
      })(),
    );
  }

  return { type: InteractionResponseType.DeferredUpdateMessage };
}
