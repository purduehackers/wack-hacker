import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";

import type { InteractionResponsePayload } from "@/bot/commands/types";

import { env } from "@/env";
import { InteractionResponseType } from "@/lib/protocol/constants";

import { EPHEMERAL_FLAG } from "./constants.ts";

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

export function buildDiscord(): API {
  return new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN));
}

export function ephemeralError(content: string): InteractionResponsePayload {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content, flags: EPHEMERAL_FLAG },
  };
}
