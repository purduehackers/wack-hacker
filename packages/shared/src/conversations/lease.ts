/**
 * Holding something, expressed once.
 *
 * This layer grew five separate ways to say "I hold this" — `claimToken`,
 * `ownerToken`, `admissionAttemptId`, `resetId`, `receiptIdentity` — each with
 * its own fence, its own TTL, and its own idea of what a lost race looks like.
 * Five protocols is five chances to get the fence wrong, and the difference
 * between them was never meaningful: every one is a holder plus a deadline.
 *
 * Two rules make the shape safe, and both were learned the hard way here.
 *
 * **A lease is fenced on its holder, never on the conversation.** A follower or
 * a sweep left over from a delivery that has moved on must not be able to renew
 * or release the one that replaced it.
 *
 * **A lease is refreshed by evidence, not by the clock.** An absolute deadline
 * measured from acquisition kills healthy long work; a deadline pushed out by
 * observable progress does not. The value to choose is therefore the widest
 * plausible *gap between signals*, not the longest job.
 */

import { z } from "zod";

/** How long a hold survives without evidence that its holder is still alive. */
export const LeaseDuration = {
  /** Handing one delivery from the queue to a process. Seconds, not minutes. */
  Handoff: 30 * 1_000,
  /** A turn that is working. Refreshed by every render it publishes. */
  Turn: 30 * 60 * 1_000,
  /** A turn parked on a person. Bounded because nothing here may be immortal. */
  Person: 24 * 60 * 60 * 1_000,
  /** One paint in flight. Renewed by the renderer between Discord writes. */
  Paint: 45 * 1_000,
  /** A delivery entering the agent, or an interaction borrowing that slot. */
  Ingress: 15 * 60 * 1_000,
} as const;

/**
 * The key's own expiry, well past the longest lease it can carry.
 *
 * Belt and braces: the sweep needs the record readable at the moment it decides
 * to give up, because what it announces is stored inside it, so Redis must not
 * collect the key first. If the sweep never runs at all, this is what still
 * bounds the key.
 */
export const RECORD_TTL_MS = 2 * LeaseDuration.Person;

export const leaseSchema = z.strictObject({
  /** Opaque and unique per acquisition. Compared byte-for-byte, never parsed. */
  holder: z.string().min(1).max(128),
  expiresAtMs: z.int().positive(),
});

export type Lease = z.output<typeof leaseSchema>;

export function grantLease(holder: string, duration: number, now: number): Lease {
  return { holder, expiresAtMs: now + duration };
}

export function leaseExpired(lease: Lease, now: number): boolean {
  return lease.expiresAtMs <= now;
}

/**
 * Whether `holder` may act on a record carrying `lease`.
 *
 * An expired lease is available to anyone — that is the whole point of a
 * deadline. A live lease belongs to its holder alone.
 */
export function leaseHeldBy(lease: Lease, holder: string, now: number): boolean {
  return lease.holder === holder && !leaseExpired(lease, now);
}

/**
 * Lua counterpart, prepended to any script that fences on a lease.
 *
 * Kept as one string for the same reason `writeActive` is: a rule spelled out at
 * each call site is a rule that will eventually be spelled differently at one of
 * them. `leaseHeld` mirrors the TypeScript above exactly, and the lockstep test
 * is what keeps that true.
 */
export const LEASE_LUA = `
local function leaseHeld(lease, holder, now)
  if not lease then return false end
  if lease.holder ~= holder then return false end
  return tonumber(lease.expiresAtMs) > tonumber(now)
end

local function leaseAvailable(lease, now)
  if not lease then return true end
  return tonumber(lease.expiresAtMs) <= tonumber(now)
end
`;
