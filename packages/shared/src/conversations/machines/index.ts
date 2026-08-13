/**
 * The transition tables, and the one question worth asking them.
 *
 * `allows*` is deliberately all that is exported besides the machines: this
 * layer must never look like it can *perform* a transition. Redis performs
 * transitions; these tables say which ones are legal, and the lockstep check in
 * `check:invariants` keeps the two honest about each other.
 */

import { transition } from "xstate";

import type { DeliveryContext, DeliveryEvent, DeliveryPhase } from "./delivery.ts";
import { deliveryMachine, DeliveryPhase as Delivery } from "./delivery.ts";
import type { RenderContext, RenderEvent, RenderPhase } from "./render.ts";
import { renderMachine, RenderPhase as Render } from "./render.ts";

export { DeliveryPhase } from "./delivery.ts";
export type { DeliveryContext, DeliveryEvent } from "./delivery.ts";
export { RenderPhase } from "./render.ts";
export type { RenderContext, RenderEvent } from "./render.ts";

/** Where a legal transition lands, or nothing when the event is refused. */
export function allowsDelivery(
  phase: DeliveryPhase,
  context: DeliveryContext,
  event: DeliveryEvent,
): DeliveryPhase | undefined {
  const snapshot = deliveryMachine.resolveState({ value: phase, context });
  if (!snapshot.can(event)) return undefined;
  return phaseOf(Delivery, transition(deliveryMachine, snapshot, event)[0].value);
}

export function allowsRender(
  phase: RenderPhase,
  context: RenderContext,
  event: RenderEvent,
): RenderPhase | undefined {
  const snapshot = renderMachine.resolveState({ value: phase, context });
  if (!snapshot.can(event)) return undefined;
  return phaseOf(Render, transition(renderMachine, snapshot, event)[0].value);
}

/**
 * Narrow xstate's `StateValue` back to our phase union.
 *
 * `StateValue` admits nested records for hierarchical machines. Ours are flat,
 * so anything other than a known phase name means a table grew a shape this was
 * not written for — reported as "no transition" rather than guessed at, so the
 * lockstep check fails loudly instead of agreeing by accident.
 */
function phaseOf<T extends string>(known: Record<string, T>, value: unknown): T | undefined {
  return Object.values(known).find((candidate) => candidate === value);
}
