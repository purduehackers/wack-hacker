import { log } from "evlog";

import type { ModalHandler } from "@/bot/modals/types";
import type { DiscordInteraction } from "@/lib/protocol/types";

import * as modalHandlers from "@/bot/handlers/modals";
import { countMetric } from "@/lib/metrics";

import type { DispatcherResult } from "./types.ts";

import { buildDiscord, describeError, ephemeralError } from "./shared.ts";

const modalHandlerList = Object.values(modalHandlers).filter(
  (v) => !!v && typeof v === "object" && "prefix" in v,
) as ModalHandler[];

export async function handleModalSubmit(
  interaction: DiscordInteraction,
): Promise<DispatcherResult> {
  const customId = interaction.data?.custom_id;
  if (!customId) return { error: "Missing custom_id", status: 400 };

  const prefix = customId.split(":")[0];
  const handler = modalHandlerList.find((h) => h.prefix === prefix);

  if (!handler) {
    log.warn("interactions", `Unexpected modal submit: ${customId}`);
    return ephemeralError("This form is no longer supported.");
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
    return ephemeralError("Something went wrong processing the form.");
  }
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
