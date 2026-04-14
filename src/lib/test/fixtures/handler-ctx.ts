import { createMockAPI, asAPI } from "./discord";
import { memoryStore } from "./redis";

export function handlerCtx(botUserId = "bot-123") {
  return {
    discord: asAPI(createMockAPI()),
    store: memoryStore(),
    botUserId,
  };
}
