import type { ModalHandler } from "@/bot/modals/types";
import type { DiscordInteraction } from "@/lib/protocol/types";

import * as modalHandlers from "@/bot/handlers/modals";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { runInstrumented } from "@/lib/otel/instrumented";

import type { DispatcherResult } from "./types.ts";

import { buildDiscord, ephemeralError } from "./shared.ts";

const modalHandlerList = Object.values(modalHandlers).filter(
  (v) => !!v && typeof v === "object" && "prefix" in v,
) as ModalHandler[];

export async function handleModalSubmit(
  interaction: DiscordInteraction,
): Promise<DispatcherResult> {
  const customId = interaction.data?.custom_id;
  if (!customId) return { error: "Missing custom_id", status: 400 };

  const prefix = customId.split(":")[0] ?? "unknown";
  const handler = modalHandlerList.find((h) => h.prefix === prefix);

  if (!handler) {
    createWideLogger({ op: "interaction.modal", modal: { prefix, custom_id: customId } }).emit({
      outcome: "unknown",
    });
    return ephemeralError("This form is no longer supported.");
  }

  countMetric("interaction.modal", { prefix });
  const startTime = Date.now();
  try {
    return await runInstrumented(
      {
        op: "interaction.modal",
        spanAttrs: { "modal.prefix": prefix },
        loggerContext: {
          modal: { prefix, custom_id: customId },
          user: { id: interaction.member?.user?.id ?? interaction.user?.id },
        },
      },
      async () => {
        const discord = buildDiscord();
        return handler.handle({
          interaction,
          discord,
          customId,
          fields: extractModalFields(interaction),
        });
      },
    );
  } catch {
    countMetric("interaction.modal_error", { prefix });
    return ephemeralError("Something went wrong processing the form.");
  } finally {
    recordDuration("interaction.modal_duration", Date.now() - startTime, { prefix });
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
