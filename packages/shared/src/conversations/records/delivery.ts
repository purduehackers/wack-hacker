/** The record that says a turn holds a conversation. One record, one owner. */

import { z } from "zod";

import { LEASE_LUA, leaseSchema } from "../lease.ts";

/**
 * Mirrors `DeliveryPhase` in `machines/delivery.ts`.
 *
 * Restated as a zod enum because this is the io boundary. The machine describes
 * what may happen, this decides what may be *read back* out of Redis. `queued`
 * is absent because a queued delivery is a list entry, not a record.
 */
export const StoredPhase = z.enum(["claimed", "live", "parked", "recovery-required"]);

export const deliveryRecordSchema = z.strictObject({
  phase: StoredPhase,
  /** Identity every fence compares against. Never re-derived. */
  dispatchId: z.uuid(),
  messageId: z.string().min(1).max(32),
  /** Empty until eve acknowledges. Several transitions turn on that emptiness. */
  sessionId: z.string().max(128),
  /** Set only when a turn parks, and fenced on thereafter. */
  eveTurnId: z.string().min(1).max(128).optional(),

  /**
   * Handing the delivery from the queue to a process.
   *
   * Short and stealable: a claimer that dies mid-handoff must not strand the
   * conversation, so an expired handoff is available to the next caller.
   */
  handoff: leaseSchema,
  /** The turn's hold, refreshed by evidence of progress rather than the clock. */
  turn: leaseSchema,
  /** A delivery entering eve, or an interaction borrowing that slot. */
  ingress: leaseSchema.optional(),

  /** The original delivery, replayed verbatim on recovery. */
  deliveryRaw: z.string(),
  /** Reported-once flag, so a wedged delivery logs one line rather than one per sweep. */
  recoveryReported: z.boolean().optional(),
});

export type DeliveryRecord = z.output<typeof deliveryRecordSchema>;

/**
 * Fence, then write. Prepended to every script that touches this record.
 *
 * `writeRecord` carries `KEEPTTL`, because a bare `SET` clears a Redis expiry —
 * the mistake that once made conversations immortal moments after `claim`
 * bounded them.
 */
export const DELIVERY_RECORD_LUA = `
${LEASE_LUA}
local function writeRecord(key, record)
  redis.call("SET", key, cjson.encode(record), "KEEPTTL")
end
`;
