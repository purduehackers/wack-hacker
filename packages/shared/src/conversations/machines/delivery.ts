/**
 * What may happen to a delivery, declared once.
 *
 * A specification, not a runtime: it declares no executable actions and never
 * touches Redis. The authority for what *did* happen stays in Lua, co-located
 * with the compare-and-set that makes it atomic, because moving a guard out here
 * would turn check-then-write into a race across two processes.
 *
 * It earns its place twice. It is one readable place to see a lifecycle that is
 * otherwise inferable only by reading six Lua scripts, and `check:invariants`
 * drives it in lockstep with those scripts, so a guard that drifts fails the gate
 * rather than surfacing later as a wedged conversation.
 */

import { setup } from "xstate";

/**
 * `expired` and `done` are both terminal and both delete the record; they are
 * kept apart because only one is a normal ending, and the difference is what the
 * thread gets told.
 */
export const DeliveryPhase = {
  Queued: "queued",
  Claimed: "claimed",
  Live: "live",
  Parked: "parked",
  RecoveryRequired: "recovery-required",
  Done: "done",
  Expired: "expired",
} as const;

export type DeliveryPhase = (typeof DeliveryPhase)[keyof typeof DeliveryPhase];

/**
 * What the guards may read.
 *
 * Only the fields a *transition* depends on. Fencing identity and the leases live
 * on the record in Redis and are checked there, in the same atomic step as the
 * write; restating them here would imply this machine could enforce them.
 */
export interface DeliveryContext {
  /** Empty until eve acknowledges the session; several guards turn on this. */
  readonly sessionId: string;
  /** Whether the terminal paint is durable. `complete` is refused without it. */
  readonly renderSettled: boolean;
}

/**
 * One shape rather than a discriminated union: no transition here carries a
 * payload, so a union buys nothing and costs inference — an annotated sample of a
 * union narrows to its initializer at xstate's `types` boundary, and the
 * assertion that would fix that is banned here.
 */
export interface DeliveryEvent {
  type:
    | "CLAIM"
    | "MARK_LIVE"
    | "CONFIRM_SESSION"
    | "PARK"
    | "COMPLETE"
    | "LOSE_ACKNOWLEDGEMENT"
    | "EXPIRE";
}

/** Annotated samples rather than `{} as T`, which this codebase bans. */
const contextShape: DeliveryContext = { sessionId: "", renderSettled: false };
const eventShape: DeliveryEvent = { type: "CLAIM" };

export const deliveryMachine = setup({
  types: { context: contextShape, events: eventShape },
  guards: {
    /** A turn may only be released once its final paint is durable. */
    renderSettled: ({ context }) => context.renderSettled,
    /** Nothing acknowledged the delivery, so nobody knows if the turn began. */
    unacknowledged: ({ context }) => context.sessionId === "",
  },
}).createMachine({
  id: "delivery",
  initial: DeliveryPhase.Queued,
  context: contextShape,
  states: {
    [DeliveryPhase.Queued]: { on: { CLAIM: DeliveryPhase.Claimed } },
    [DeliveryPhase.Claimed]: {
      on: { MARK_LIVE: DeliveryPhase.Live, EXPIRE: DeliveryPhase.Expired },
    },
    [DeliveryPhase.Live]: {
      on: {
        CONFIRM_SESSION: DeliveryPhase.Live,
        PARK: DeliveryPhase.Parked,
        // The agent took the delivery and never came back to say a session
        // began. Held rather than retried, because retrying might run it twice.
        LOSE_ACKNOWLEDGEMENT: { target: DeliveryPhase.RecoveryRequired, guard: "unacknowledged" },
        EXPIRE: DeliveryPhase.Expired,
      },
    },
    [DeliveryPhase.Parked]: {
      on: {
        // Re-parking is normal: a turn can park, resume on an answer, and park
        // again, and each park re-settles the same delivery.
        PARK: DeliveryPhase.Parked,
        COMPLETE: { target: DeliveryPhase.Done, guard: "renderSettled" },
        EXPIRE: DeliveryPhase.Expired,
      },
    },
    // Deliberately a dead end apart from expiry: recovery is a decision to stop
    // rather than guess, and the lease is what eventually releases it.
    [DeliveryPhase.RecoveryRequired]: { on: { EXPIRE: DeliveryPhase.Expired } },
    [DeliveryPhase.Done]: { type: "final" },
    [DeliveryPhase.Expired]: { type: "final" },
  },
});
