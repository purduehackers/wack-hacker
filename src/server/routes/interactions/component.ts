import { waitUntil } from "@vercel/functions";

import type { ComponentHandler } from "@/bot/components/types";
import type { DiscordInteraction } from "@/lib/protocol/types";

import * as components from "@/bot/components";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";
import { InteractionResponseType } from "@/lib/protocol/constants";

import type { DispatcherResult } from "./types.ts";

import { buildDiscord, describeError } from "./shared.ts";

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
    waitUntil(
      withSpan("interaction.component", { "component.prefix": prefix }, async () => {
        const logger = createWideLogger({
          op: "interaction.component",
          component: { prefix, custom_id: customId },
          user: { id: interaction.member?.user?.id ?? interaction.user?.id },
        });
        const startTime = Date.now();
        try {
          await handler.handle({ interaction, discord, customId });
          logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
        } catch (err: unknown) {
          countMetric("interaction.component_error", { prefix });
          logger.error(err as Error);
          logger.emit({
            outcome: "error",
            duration_ms: Date.now() - startTime,
            error_summary: describeError(err),
          });
        } finally {
          recordDuration("interaction.component_duration", Date.now() - startTime, { prefix });
        }
      }),
    );
  }

  return { type: InteractionResponseType.DeferredUpdateMessage };
}
