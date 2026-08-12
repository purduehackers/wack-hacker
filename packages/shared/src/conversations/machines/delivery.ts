/**
 * What may happen to a delivery, declared once.
 *
 * The authority for what *did* happen stays in Redis: transitions execute inside
 * Lua, co-located with the compare-and-set that makes them atomic, and moving a
 * guard out here would turn check-then-write into a race across two processes.
 * So this machine is a specification, not a runtime — it declares no executable
 * actions and never touches Redis.
 *
 * It earns its place three ways. It answers `can()` before a write, so a refusal
 * carries a reason instead of a bare `0`. It is one readable place to see a
 * lifecycle that was previously spread across six Lua scripts and inferable only
 * by reading all of them. And `check:invariants` drives it in lockstep with the
 * real scripts, so a guard that drifts from this table fails the gate rather
 * than surfacing later as a wedged conversation.
 */

import { setup } from "xstate";

/**
 * Where a delivery is.
 *
 * `expired` and `done` are both terminal and both delete the record; they are
 * kept apart because only one of them is a normal ending, and the difference is
 * what the thread gets told.
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
 * What the guards are allowed to read.
 *
 * Deliberately only the fields a *transition* depends on. Fencing identity
 * (`dispatchId`, `messageId`) and the lease live on the record in Redis and are
 * checked there, in the same atomic step as the write — restating them here
 * would imply this machine could enforce them, and it cannot.
 */
export interface DeliveryContext {
  /** Empty until eve acknowledges the session; several guards turn on this. */
  readonly sessionId: string;
  /** Whether the terminal paint is durable. `complete` is refused without it. */
  readonly renderSettled: boolean;
}

/**
 * One shape rather than a discriminated union.
 *
 * No transition here carries a payload — what a guard reads lives in the
 * context, and what a fence checks lives in Redis — so a union buys nothing and
 * costs inference: an annotated sample of a union narrows to its initializer at
 * xstate's `types` boundary, and the assertion that would fix that is banned
 * here.
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

/**
 * Annotated sample values rather than `{} as T`.
 *
 * The canonical xstate idiom uses a type assertion, which this codebase bans.
 * `SetupTypes` declares these as ordinary optional value props, so an annotated
 * literal carries the same information to inference without one.
 */
const contextShape: DeliveryContext = { sessionId: "", renderSettled: false };
const eventShape: DeliveryEvent = { type: "CLAIM" };

export const deliveryMachine = setup({
  types: { context: contextShape, events: eventShape },
  guards: {
    /**
     * A turn may only be released once its final paint is durable.
     *
     * This was an ordering comment in the bot's sweep — "render first so a
     * durable terminal outcome is present" — enforced by one `if` buried in
     * `wack:complete`. Ordering is not a guarantee; this is.
     */
    renderSettled: ({ context }) => context.renderSettled,
    /** Nothing acknowledged the delivery, so nobody knows if the turn began. */
    unacknowledged: ({ context }) => context.sessionId === "",
  },
}).createMachine({
  id: "delivery",
  initial: DeliveryPhase.Queued,
  context: contextShape,
  states: {
    [DeliveryPhase.Queued]: {
      on: { CLAIM: DeliveryPhase.Claimed },
    },
    [DeliveryPhase.Claimed]: {
      on: {
        MARK_LIVE: DeliveryPhase.Live,
        EXPIRE: DeliveryPhase.Expired,
      },
    },
    [DeliveryPhase.Live]: {
      on: {
        CONFIRM_SESSION: DeliveryPhase.Live,
        PARK: DeliveryPhase.Parked,
        // The agent took the delivery and never came back to say a session
        // began. Held rather than retried, because retrying might run it twice.
        LOSE_ACKNOWLEDGEMENT: {
          target: DeliveryPhase.RecoveryRequired,
          guard: "unacknowledged",
        },
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
    [DeliveryPhase.RecoveryRequired]: {
      // Deliberately a dead end apart from expiry: recovery is a decision to
      // stop rather than guess, and the lease is what eventually releases it.
      on: { EXPIRE: DeliveryPhase.Expired },
    },
    [DeliveryPhase.Done]: { type: "final" },
    [DeliveryPhase.Expired]: { type: "final" },
  },
});
