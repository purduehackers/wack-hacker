import type { API } from "@discordjs/core/http-only";

import type { InteractionResponsePayload } from "@/bot/commands/types";
import type { DiscordInteraction } from "@/lib/protocol/types";

export interface ModalSubmitContext {
  interaction: DiscordInteraction;
  discord: API;
  customId: string;
  /** Flat map of text-input custom_id → submitted value, collected from every action row. */
  fields: Map<string, string>;
}

export interface ModalHandler {
  prefix: string;
  handle(ctx: ModalSubmitContext): Promise<InteractionResponsePayload>;
}
