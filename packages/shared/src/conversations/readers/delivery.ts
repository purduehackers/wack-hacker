/**
 * Reads of the delivery record. Never writes.
 *
 * Split from the writer so the two halves cannot be confused for each other. A
 * reader that can also mutate is how a "quick lookup" becomes a transition
 * nobody accounted for, which is most of how this layer accumulated writers.
 *
 * Every read decodes through the schema. Upstash returns either stored JSON text
 * or an already-parsed value depending on how it was written, so `stored` accepts
 * both; a record that fails to decode is reported as absent rather than guessed
 * at, because a half-understood record is worse than none.
 */

import { z } from "zod";

import { stored } from "../../json.ts";
import type { RedisClient } from "../../redis/client.ts";
import { Result } from "../../result/index.ts";
import type { ParkedPayload } from "../../wire.ts";
import { decodeParkedPayload } from "../../wire.ts";
import { activeKey, parkedKey, pendingKey } from "../keys.ts";
import { leaseExpired } from "../lease.ts";
import type { DeliveryRecord } from "../records/delivery.ts";
import { deliveryRecordSchema } from "../records/delivery.ts";

const storedRecord = stored(deliveryRecordSchema);

/**
 * Redis hands a record back as JSON text or as the value, depending on how it
 * was written. Both go to the decoder that owns the shape.
 */
function readValue(raw: unknown): unknown {
  const text = z.string().safeParse(raw);
  return text.success ? JSON.parse(text.data) : raw;
}

/** What a live turn is holding a conversation for. */
export interface Holder {
  readonly sessionId: string;
  readonly dispatchId: string;
  /** The request being worked on, so a steer can carry it forward. */
  readonly content?: string;
}

/**
 * Only the field a superseded request is recovered from.
 *
 * Loose because the rest of the delivery is not this reader's business, and
 * tightening it here would mean every wire change had to be mirrored in a place
 * that only ever wanted one string.
 */
const storedContent = stored(z.looseObject({ content: z.string() }));

export class DeliveryReader {
  private readonly redis: Pick<RedisClient, "get" | "llen">;

  constructor(redis: Pick<RedisClient, "get" | "llen">) {
    this.redis = redis;
  }

  /** The record, or nothing when absent or undecodable. */
  async read(continuationKey: string): Promise<DeliveryRecord | undefined> {
    const raw: unknown = await this.redis.get(activeKey(continuationKey));
    if (raw === null || raw === undefined) return undefined;
    const parsed = storedRecord.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  /**
   * The turn currently holding this conversation, if one is.
   *
   * `claim` refuses while such a record exists, which is correct — the turn is
   * still running — but it also means a newly queued message has no way to
   * reach the agent. This is how the bot finds out there is something to
   * interrupt, and what it is interrupting.
   */
  async holder(continuationKey: string): Promise<Holder | undefined> {
    const record = await this.read(continuationKey);
    if (record === undefined || record.phase !== "live" || record.sessionId === "") {
      return undefined;
    }
    const delivery = storedContent.safeParse(record.deliveryRaw);
    return {
      sessionId: record.sessionId,
      dispatchId: record.dispatchId,
      ...(delivery.success && delivery.data.content !== ""
        ? { content: delivery.data.content }
        : {}),
    };
  }

  /** Whether the turn's hold has lapsed, which is what the sweep acts on. */
  async lapsed(continuationKey: string, now: number): Promise<boolean> {
    const record = await this.read(continuationKey);
    return record !== undefined && leaseExpired(record.turn, now);
  }

  /** The parked marker, decoded — never handed back as an unvalidated value. */
  async parked(continuationKey: string): Promise<ParkedPayload | undefined> {
    const raw: unknown = await this.redis.get(parkedKey(continuationKey));
    if (raw === null || raw === undefined) return undefined;
    const decoded = decodeParkedPayload(readValue(raw));
    return Result.isOk(decoded) ? decoded.value : undefined;
  }

  async queueDepth(continuationKey: string): Promise<number> {
    return this.redis.llen(pendingKey(continuationKey));
  }
}
