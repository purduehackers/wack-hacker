import type { API } from "@discordjs/core/http-only";

import type { InteractionResponsePayload } from "@/bot/commands/types";

import { createDiscordAPI } from "@/lib/discord/client";
import { InteractionResponseType } from "@/lib/protocol/constants";

import { EPHEMERAL_FLAG } from "./constants.ts";

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

export function buildDiscord(): API {
  return createDiscordAPI();
}

export function ephemeralError(content: string): InteractionResponsePayload {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content, flags: EPHEMERAL_FLAG },
  };
}
