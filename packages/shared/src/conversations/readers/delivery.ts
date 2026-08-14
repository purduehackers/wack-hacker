/**
 * Reads of the delivery record. Never writes.
 *
 * Split from the writer so a "quick lookup" cannot quietly become a transition.
 * A record that fails to decode reads as absent. The reader never guesses at it.
 */

import { z } from "zod";

import { stored } from "../../json.ts";
import type { RedisClient } from "../../redis/client.ts";
import { Result } from "../../result/index.ts";
import type { ParkedPayload } from "../../wire.ts";
import { decodeParkedPayload } from "../../wire.ts";
import { redisValue } from "../io.ts";
import {
  activeKey,
  AGENT_READY_SET_KEY,
  continuationKeyFromQueueMember,
  parkedKey,
  pendingKey,
  QUEUE_INDEX_KEY,
} from "../keys.ts";
import { leaseExpired } from "../lease.ts";
import type { DeliveryRecord } from "../records/delivery.ts";
import { deliveryRecordSchema } from "../records/delivery.ts";

const storedRecord = stored(deliveryRecordSchema);

/**
 * Only the field needed to recover a superseded request.
 *
 * Loose because the rest of the delivery is not this reader's business.
 * Tightening it here would mirror every wire change into a place that only
 * ever wanted one string.
 */
const storedContent = stored(z.looseObject({ content: z.string() }));

/** What a live turn holds a conversation for. */
export interface Holder {
  readonly sessionId: string;
  readonly dispatchId: string;
  /** The request the turn works on, so a steer can carry it forward. */
  readonly content?: string;
}

/**
 * Read-only view of one conversation's delivery state in Redis. It answers
 * who holds a turn, what waits in the queue, and which holds lapsed, without
 * the power to transition anything.
 */
export class DeliveryReader {
  private readonly redis: Pick<RedisClient, "get" | "llen" | "smembers">;

  constructor(redis: Pick<RedisClient, "get" | "llen" | "smembers">) {
    this.redis = redis;
  }

  /** The record, or nothing when absent or undecodable. */
  async read(continuationKey: string): Promise<DeliveryRecord | undefined> {
    const raw: unknown = await this.redis.get(activeKey(continuationKey));
    if (raw === null || raw === undefined) return undefined;
    return storedRecord.safeParse(raw).data;
  }

  /**
   * The turn currently holding this conversation, if one is.
   *
   * `claim` refuses while such a record exists — the turn is still running.
   * This is how the bot finds out there is something to interrupt, and what.
   */
  async holder(continuationKey: string): Promise<Holder | undefined> {
    const record = await this.read(continuationKey);
    if (record === undefined || record.phase !== "live" || record.sessionId === "") {
      return undefined;
    }
    const content = storedContent.safeParse(record.deliveryRaw).data?.content;
    return {
      sessionId: record.sessionId,
      dispatchId: record.dispatchId,
      ...(content !== undefined && content !== "" && { content }),
    };
  }

  /** Whether the turn's hold lapsed by `now`, which is what the sweep acts on. */
  async lapsed(continuationKey: string, now: number): Promise<boolean> {
    const record = await this.read(continuationKey);
    return record !== undefined && leaseExpired(record.turn, now);
  }

  /** The parked marker, decoded — never handed back as an unvalidated value. */
  async parked(continuationKey: string): Promise<ParkedPayload | undefined> {
    const raw: unknown = await this.redis.get(parkedKey(continuationKey));
    if (raw === null || raw === undefined) return undefined;
    const decoded = decodeParkedPayload(redisValue(raw));
    return Result.isOk(decoded) ? decoded.value : undefined;
  }

  async queueDepth(continuationKey: string): Promise<number> {
    return this.redis.llen(pendingKey(continuationKey));
  }

  /** Every conversation with work outstanding. */
  async conversations(): Promise<readonly string[]> {
    return continuationKeys(await this.redis.smembers(QUEUE_INDEX_KEY));
  }

  /** Conversations with a parked turn waiting for reconciliation. */
  async awaitingReconcile(): Promise<readonly string[]> {
    return continuationKeys(await this.redis.smembers(AGENT_READY_SET_KEY));
  }
}

/**
 * This helper drops a malformed index member instead of throwing on it. The
 * sweep reads these sets every pass, and one bad member must not stop the
 * sweep reaching the rest.
 */
function continuationKeys(members: readonly unknown[]): readonly string[] {
  return members.flatMap((entry) => {
    const continuationKey = continuationKeyFromQueueMember(entry);
    return continuationKey === undefined ? [] : [continuationKey];
  });
}
