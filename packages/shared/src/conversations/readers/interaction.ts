/** Reads of interaction receipts. Never writes. */

import { InvalidInput } from "../../errors.ts";
import { stored } from "../../json.ts";
import type { RedisClient } from "../../redis/client.ts";
import { Result } from "../../result/index.ts";
import { interactionReceiptKey } from "../keys.ts";
import type { InteractionReceipt } from "../records/interaction.ts";
import { interactionReceiptSchema } from "../records/interaction.ts";

const storedReceipt = stored(interactionReceiptSchema);

export class InteractionReader {
  private readonly redis: Pick<RedisClient, "get">;

  constructor(redis: Pick<RedisClient, "get">) {
    this.redis = redis;
  }

  /**
   * What was decided about this click, if anything.
   *
   * Parsed here rather than at the call site. The route that replays an accepted
   * answer used to restate the receipt's shape in its own zod schema, which meant
   * two declarations of one record that nothing kept in step.
   */
  async receipt(
    interactionId: string,
  ): Promise<Result<InteractionReceipt | undefined, InvalidInput>> {
    const raw: unknown = await this.redis.get(interactionReceiptKey(interactionId));
    if (raw === null || raw === undefined) return Result.ok(undefined);
    const parsed = storedReceipt.safeParse(raw);
    return parsed.success
      ? Result.ok(parsed.data)
      : Result.err(
          new InvalidInput({
            subject: "interaction receipt",
            issues: parsed.error.issues.map(({ message, path }) => `${path.join(".")}: ${message}`),
          }),
        );
  }
}
