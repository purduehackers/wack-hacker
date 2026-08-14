/**
 * Reads of the render aggregate. Never writes.
 *
 * Four keys per delivery, each answering a different question:
 *
 * - the *intent* is what the agent wants shown,
 * - the *target* is where the bot may paint it,
 * - the *projection* is what is currently on screen,
 * - the *outcome* is whether the final state is durable.
 *
 * A paint needs all four.
 */

import type { InvalidInput } from "../../errors.ts";
import type { RedisClient } from "../../redis/client.ts";
import { Result } from "../../result/index.ts";
import type { RenderIntent, RenderTarget } from "../../wire.ts";
import { decodeRenderIntent, decodeRenderTarget } from "../../wire.ts";
import { decodeStored, redisValue } from "../io.ts";
import {
  AGENT_RENDER_READY_SET_KEY,
  dispatchIdFromRenderMember,
  renderIntentKey,
  renderOutcomeKey,
  renderProjectionKey,
  renderTargetKey,
} from "../keys.ts";
import type { RenderOutcome, StoredRenderProjection } from "../records/render.ts";
import { renderProjectionSchema } from "../records/render.ts";

/**
 * Read-only view of the four render keys of one delivery. It takes only
 * `get` and `smembers`, so holding a reader can never mutate a paint.
 */
export class RenderReader {
  private readonly redis: Pick<RedisClient, "get" | "smembers">;

  constructor(redis: Pick<RedisClient, "get" | "smembers">) {
    this.redis = redis;
  }

  /** Dispatches with a paint outstanding. */
  async pending(): Promise<readonly string[]> {
    const advertised = await this.redis.smembers(AGENT_RENDER_READY_SET_KEY);
    return advertised.flatMap((entry) => {
      const dispatchId = dispatchIdFromRenderMember(entry);
      return dispatchId === undefined ? [] : [dispatchId];
    });
  }

  /** What the agent wants shown, or nothing if it has said nothing yet. */
  async intent(dispatchId: string): Promise<Result<RenderIntent | undefined, InvalidInput>> {
    const raw: unknown = await this.redis.get(renderIntentKey(dispatchId));
    if (raw === null || raw === undefined) return Result.ok(undefined);
    return decodeRenderIntent(redisValue(raw));
  }

  /** Where the bot may paint it. Immutable for the life of the delivery. */
  async target(dispatchId: string): Promise<Result<RenderTarget | undefined, InvalidInput>> {
    const raw: unknown = await this.redis.get(renderTargetKey(dispatchId));
    if (raw === null || raw === undefined) return Result.ok(undefined);
    return decodeRenderTarget(redisValue(raw));
  }

  /**
   * What is currently on screen.
   *
   * An absent projection is a delivery before its first paint, which is a
   * normal starting state. So it reads as an empty one, seeded with the anchor
   * the bot may have already posted.
   */
  async projection(
    dispatchId: string,
    anchorMessageId?: string,
  ): Promise<Result<StoredRenderProjection, InvalidInput>> {
    const raw: unknown = await this.redis.get(renderProjectionKey(dispatchId));
    const decoded = decodeStored(renderProjectionSchema, "render projection", raw);
    if (Result.isError(decoded)) return decoded;
    return Result.ok(
      decoded.value ?? {
        ...(anchorMessageId === undefined ? {} : { anchorMessageId }),
        overflow: [],
        appliedRevision: 0,
      },
    );
  }

  /**
   * Whether the final state is durable.
   *
   * The delivery machine will not release a conversation without this, which is
   * the one guard spanning both machines.
   */
  async outcome(dispatchId: string): Promise<RenderOutcome | undefined> {
    const raw: unknown = await this.redis.get(renderOutcomeKey(dispatchId));
    return raw === "applied" || raw === "discarded" ? raw : undefined;
  }
}
