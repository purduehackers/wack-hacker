/**
 * The record that says a turn holds a conversation.
 *
 * One record, and — unlike the shape it replaces — one owner. Previously eleven
 * Lua scripts across three files rewrote it, fenced by six different predicates,
 * and every invariant it carried had to be remembered independently by all of
 * them. Most of the defects in this layer were some writer forgetting one.
 *
 * The three leases are the substantive change. They were `ownerToken` +
 * `deliveryLeaseUntilMs`, a bare `expiresAtMs` with no holder at all, and
 * `admissionAttemptId` living in a second key — three different spellings of
 * "somebody holds this until some time". Naming them the same thing makes the
 * fences comparable, and gives the bare one a holder it never had.
 */

import { z } from "zod";

import { LEASE_LUA, leaseSchema } from "../lease.ts";

/**
 * Mirrors `DeliveryPhase` in `machines/delivery.ts`.
 *
 * Restated as a zod enum because this is the io boundary: the machine describes
 * what may happen, this decides what is allowed to be *read back* out of Redis.
 * `queued` is absent on purpose — a queued delivery is a list entry, not a
 * record, so it has no persisted form to decode.
 */
export const StoredPhase = z.enum(["claimed", "live", "parked", "recovery-required"]);

export const deliveryRecordSchema = z.strictObject({
  phase: StoredPhase,
  /** Identity every fence compares against; never re-derived. */
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
  /**
   * The turn's hold on the conversation.
   *
   * Refreshed by evidence of progress rather than by the clock — see
   * `../lease.ts` for why an absolute deadline was tried and reverted.
   */
  turn: leaseSchema,
  /**
   * A delivery entering eve, or an interaction borrowing that slot.
   *
   * Was a separate `agent:ingress:<key>`, which is why an interaction had to
   * release it by calling `admission.finish` with its own id — a coupling that
   * reads as a bug until you find the one line that explains it.
   */
  ingress: leaseSchema.optional(),

  /** The original delivery, replayed verbatim on recovery. */
  deliveryRaw: z.string(),
  /** Reported-once flag, so a wedged delivery logs one line rather than one per sweep. */
  recoveryReported: z.boolean().optional(),
});

export type DeliveryRecord = z.output<typeof deliveryRecordSchema>;

/**
 * The persisted form's Lua counterpart: fence, then write.
 *
 * Prepended to every script that touches this record, in either writer. Kept
 * beside the schema because both express the same thing — what this record is
 * allowed to look like after a write — and a `SET` written out by hand at each
 * call site is a `SET` that will eventually be written differently at one of
 * them. It already was: `KEEPTTL` was forgotten in three scripts at once, which
 * cleared the expiry `claim` had just set and left four conversations wedged for
 * a day with no deadline to rescue them.
 */
export const DELIVERY_RECORD_LUA = `
${LEASE_LUA}
local function writeRecord(key, record)
  redis.call("SET", key, cjson.encode(record), "KEEPTTL")
end
`;
