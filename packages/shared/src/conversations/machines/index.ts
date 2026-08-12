/**
 * The transition tables, and the one question worth asking them.
 *
 * `allows` is deliberately the only thing exported besides the machines: this
 * layer must never look like it can *perform* a transition. Redis performs
 * transitions; these tables say which ones are legal, and the lockstep check in
 * `check:invariants` is what keeps the two honest about each other.
 */

import { transition } from "xstate";

import type { DeliveryContext, DeliveryEvent, DeliveryPhase } from "./delivery.ts";
import { deliveryMachine } from "./delivery.ts";
import type { RenderContext, RenderEvent, RenderPhase } from "./render.ts";
import { renderMachine } from "./render.ts";

export { deliveryMachine, DeliveryPhase } from "./delivery.ts";
export type { DeliveryContext, DeliveryEvent } from "./delivery.ts";
export { renderMachine, RenderPhase } from "./render.ts";
export type { RenderContext, RenderEvent } from "./render.ts";

/** Where a legal transition lands, or nothing when the event is refused. */
export interface Allowed<TPhase> {
  readonly next: TPhase;
}

export function allowsDelivery(
  phase: DeliveryPhase,
  context: DeliveryContext,
  event: DeliveryEvent,
): Allowed<DeliveryPhase> | undefined {
  const snapshot = deliveryMachine.resolveState({ value: phase, context });
  if (!snapshot.can(event)) return undefined;
  const [next] = transition(deliveryMachine, snapshot, event);
  // `value` is a phase name because this machine is flat — no parallel or
  // nested states — so the string form is the whole answer.
  const landed = deliveryPhaseOf(next.value);
  return landed === undefined ? undefined : { next: landed };
}

export function allowsRender(
  phase: RenderPhase,
  context: RenderContext,
  event: RenderEvent,
): Allowed<RenderPhase> | undefined {
  const snapshot = renderMachine.resolveState({ value: phase, context });
  if (!snapshot.can(event)) return undefined;
  const [next] = transition(renderMachine, snapshot, event);
  const landed = renderPhaseOf(next.value);
  return landed === undefined ? undefined : { next: landed };
}

/**
 * Narrow xstate's `StateValue` back to our phase union.
 *
 * `StateValue` admits nested records for hierarchical machines. Ours are flat,
 * so anything other than a known phase name means the table grew a shape this
 * helper was not written for — reported as "no transition" rather than guessed
 * at, so the lockstep check fails loudly instead of agreeing by accident.
 */
function deliveryPhaseOf(value: unknown): DeliveryPhase | undefined {
  return DELIVERY_PHASES.find((phase) => phase === value);
}

function renderPhaseOf(value: unknown): RenderPhase | undefined {
  return RENDER_PHASES.find((phase) => phase === value);
}

const DELIVERY_PHASES: readonly DeliveryPhase[] = [
  "queued",
  "claimed",
  "live",
  "parked",
  "recovery-required",
  "done",
  "expired",
];

const RENDER_PHASES: readonly RenderPhase[] = ["unclaimed", "claimed", "applied", "discarded"];
