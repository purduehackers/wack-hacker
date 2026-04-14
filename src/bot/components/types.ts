import type { API } from "@discordjs/core/http-only";

import type { DiscordInteraction } from "@/lib/protocol/types";

export interface ComponentContext {
  interaction: DiscordInteraction;
  discord: API;
  customId: string;
}

export interface ComponentHandler {
  prefix: string;
  handle(ctx: ComponentContext): Promise<void>;
}
