/**
 * Holding something, expressed once.
 *
 * Two rules make the shape safe, and this codebase learned both the hard way.
 *
 * **A lease fences on its holder, never on the conversation.**
 *
 * A follower or a sweep can be left over from a delivery that moved on. It must
 * not be able to renew or release the one that replaced it.
 *
 * **Evidence refreshes a lease, not the clock.**
 *
 * An absolute deadline measured from acquisition kills healthy long work. A
 * deadline pushed out by observable progress does not. The value to choose is
 * therefore the widest plausible *gap between signals*, not the longest job.
 */

import { z } from "zod";

/** How long a hold survives without evidence that its holder is still alive. */
export const LeaseDuration = {
  /** Handing one delivery from the queue to a process. Seconds, not minutes. */
  Handoff: 30 * 1_000,
  /** A working turn. Every render it publishes refreshes the hold. */
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
 * The sweep needs the record readable at the moment it decides to give up,
 * because what it announces lives inside the record. If the sweep never runs at
 * all, this is what still bounds the key.
 */
export const RECORD_TTL_MS = 2 * LeaseDuration.Person;

export const leaseSchema = z.strictObject({
  /** Opaque and unique per acquisition. Compared byte-for-byte, never parsed. */
  holder: z.string().min(1).max(128),
  expiresAtMs: z.int().positive(),
});

export type Lease = z.output<typeof leaseSchema>;

/**
 * Expiry at exactly `now` counts as expired, to match the `<=` in
 * `leaseAvailable`. Both runtimes then agree on the instant a hold ends.
 */
export function leaseExpired(lease: Lease, now: number): boolean {
  return lease.expiresAtMs <= now;
}

/**
 * Lua counterpart, prepended to any script that fences on a lease.
 *
 * `leaseHeld` mirrors `leaseExpired` above, and the lockstep check in
 * `check:invariants` is what keeps that true.
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
