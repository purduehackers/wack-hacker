import { createDiscordAdapter } from "@chat-adapter/discord";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat } from "chat";

import type { ThreadState } from "./types";

const adapters = {
  discord: createDiscordAdapter(),
};

export const bot = new Chat<typeof adapters, ThreadState>({
  userName: "wack-hacker",
  adapters,
  state: createRedisState(),
}).registerSingleton();
