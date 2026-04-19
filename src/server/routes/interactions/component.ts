import { waitUntil } from "@vercel/functions";
import { log } from "evlog";

import type { ComponentHandler } from "@/bot/components/types";
import type { DiscordInteraction } from "@/lib/protocol/types";

import * as components from "@/bot/components";
import { countMetric } from "@/lib/metrics";
import { InteractionResponseType } from "@/lib/protocol/constants";

import type { DispatcherResult } from "./types.ts";

import { buildDiscord, describeError } from "./shared.ts";

const componentHandlers = Object.values(components).filter(
  (v) => !!v && typeof v === "object" && "prefix" in v,
) as ComponentHandler[];

export function handleMessageComponent(interaction: DiscordInteraction): DispatcherResult {
  const customId = interaction.data?.custom_id;
  if (!customId) return { error: "Missing custom_id", status: 400 };

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
