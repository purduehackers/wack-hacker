/**
 * What may happen to one dispatch's paint, declared once.
 *
 * A specification like its delivery counterpart; see `./delivery.ts` for why the
 * guards cannot move out of Lua.
 *
 * The lifecycle is short but its terminal states are load-bearing, because they
 * are what release the delivery. `applied` means Discord shows the final state;
 * `discarded` means it never can — a message deleted underneath us, or a 4xx that
 * will not improve on retry.
 */

import { setup } from "xstate";

export const RenderPhase = {
  /** Desired state published, nothing holds the paint. */
  Unclaimed: "unclaimed",
  /** A renderer holds the lease and is writing to Discord. */
  Claimed: "claimed",
  Applied: "applied",
  Discarded: "discarded",
} as const;

export type RenderPhase = (typeof RenderPhase)[keyof typeof RenderPhase];

export interface RenderContext {
  /**
   * A paint that finishes behind the desired revision is not finished: the
   * renderer goes back to unclaimed so the sweep drains the rest, which is the
   * `"newer"` result the bot loops on.
   */
  readonly desiredRevision: number;
  readonly appliedRevision: number;
  /** Only a terminal intent produces a terminal paint. */
  readonly terminal: boolean;
}

/** One shape, for the reason given on `DeliveryEvent`. */
export interface RenderEvent {
  type: "CLAIM" | "PUBLISH" | "SETTLE" | "DISCARD" | "RELEASE";
}

const contextShape: RenderContext = { desiredRevision: 0, appliedRevision: 0, terminal: false };
const eventShape: RenderEvent = { type: "CLAIM" };

export const renderMachine = setup({
  types: { context: contextShape, events: eventShape },
  guards: {
    /** Caught up *and* terminal, so the outcome is durable. */
    settled: ({ context }) =>
      context.terminal && context.appliedRevision >= context.desiredRevision,
  },
}).createMachine({
  id: "render",
  initial: RenderPhase.Unclaimed,
  context: contextShape,
  states: {
    [RenderPhase.Unclaimed]: {
      on: {
        CLAIM: RenderPhase.Claimed,
        // A newer revision arrives while nothing holds the paint; still nothing
        // to release, so this only moves the target.
        PUBLISH: RenderPhase.Unclaimed,
        DISCARD: RenderPhase.Discarded,
      },
    },
    [RenderPhase.Claimed]: {
      on: {
        SETTLE: [
          { target: RenderPhase.Applied, guard: "settled" },
          // Caught up but not terminal, or overtaken mid-paint: drop the lease
          // and let the sweep pick the dispatch up again.
          { target: RenderPhase.Unclaimed },
        ],
        RELEASE: RenderPhase.Unclaimed,
        DISCARD: RenderPhase.Discarded,
      },
    },
    // Both terminal states are re-enterable: publishing a newer revision clears
    // the outcome and puts the dispatch back in play, which is what lets a turn
    // park, resume, and paint again under one dispatch.
    [RenderPhase.Applied]: {
      on: { PUBLISH: RenderPhase.Unclaimed, DISCARD: RenderPhase.Discarded },
    },
    [RenderPhase.Discarded]: { on: { PUBLISH: RenderPhase.Unclaimed } },
  },
});
