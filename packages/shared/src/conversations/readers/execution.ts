import type { RedisClient } from "../../redis/client.ts";
import { decodeStored } from "../io.ts";
import { executionKey, dispatchExecutionKey } from "../keys.ts";
import { executionBindingSchema } from "../records/execution.ts";

export class ExecutionReader {
  private readonly redis: Pick<RedisClient, "get">;

  constructor(redis: Pick<RedisClient, "get">) {
    this.redis = redis;
  }

  async read(continuationKey: string) {
    return decodeStored(
      executionBindingSchema,
      "conversation execution binding",
      await this.redis.get(executionKey(continuationKey)),
    );
  }

  async dispatch(dispatchId: string) {
    return decodeStored(
      executionBindingSchema,
      "dispatch execution binding",
      await this.redis.get(dispatchExecutionKey(dispatchId)),
    );
  }
}
