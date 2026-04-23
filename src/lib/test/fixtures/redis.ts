import { ConversationStore } from "@/bot/store";
import { createMemoryRedis } from "@/lib/redis/fakes";

export { createMemoryRedis } from "@/lib/redis/fakes";

export function memoryStore(): ConversationStore {
  return new ConversationStore(createMemoryRedis());
}
