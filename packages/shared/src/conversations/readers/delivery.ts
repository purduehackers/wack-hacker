/**
 * Reads of the delivery record. Never writes.
 *
 * Split from the writer so a "quick lookup" cannot quietly become a transition.
 * A record that fails to decode reads as absent rather than being guessed at.
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
 * Only the field a superseded request is recovered from.
 *
 * Loose because the rest of the delivery is not this reader's business, and
 * tightening it here would mirror every wire change into a place that only ever
 * wanted one string.
 */
const storedContent = stored(z.looseObject({ content: z.string() }));

/** What a live turn is holding a conversation for. */
export interface Holder {
  readonly sessionId: string;
  readonly dispatchId: string;
  /** The request being worked on, so a steer can carry it forward. */
  readonly content?: string;
}

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
   * `claim` refuses while such a record exists — the turn is still running — so
   * this is how the bot finds out there is something to interrupt, and what.
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
      ...(content === undefined || content === "" ? {} : { content }),
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

  /** Conversations with a parked turn waiting to be reconciled. */
  async awaitingReconcile(): Promise<readonly string[]> {
    return continuationKeys(await this.redis.smembers(AGENT_READY_SET_KEY));
  }
}

/**
 * A malformed index member is dropped rather than thrown on: these sets are
 * swept every pass, and one bad member must not stop the sweep reaching the rest.
 */
function continuationKeys(members: readonly unknown[]): readonly string[] {
  return members.flatMap((entry) => {
    const continuationKey = continuationKeyFromQueueMember(entry);
    return continuationKey === undefined ? [] : [continuationKey];
  });
}
