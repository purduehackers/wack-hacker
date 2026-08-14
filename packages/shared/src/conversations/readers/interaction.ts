/** Reads of interaction receipts. Never writes. */

import type { InvalidInput } from "../../errors.ts";
import type { RedisClient } from "../../redis/client.ts";
import type { Result } from "../../result/index.ts";
import { decodeStored } from "../io.ts";
import { interactionReceiptKey } from "../keys.ts";
import type { InteractionReceipt } from "../records/interaction.ts";
import { interactionReceiptSchema } from "../records/interaction.ts";

/**
 * Read-only view of interaction receipts. A receipt is what makes a retried
 * click idempotent, so this class takes only `get` and can never mint one.
 */
export class InteractionReader {
  private readonly redis: Pick<RedisClient, "get">;

  constructor(redis: Pick<RedisClient, "get">) {
    this.redis = redis;
  }

  /** What the admission decided about this click, if anything. */
  async receipt(
    interactionId: string,
  ): Promise<Result<InteractionReceipt | undefined, InvalidInput>> {
    const raw: unknown = await this.redis.get(interactionReceiptKey(interactionId));
    return decodeStored(interactionReceiptSchema, "interaction receipt", raw);
  }
}
