/**
 * The event registry.
 *
 * Explicit, for the same reason the command registry is: the legacy app
 * discovered handlers by scanning barrel re-exports, so a forgotten export
 * silently unregistered a behaviour.
 *
 * Not yet here, because they need the agent seam: the mention handler that opens
 * a conversation, the ✅ reaction that ends one, and the feedback reaction that
 * records sentiment against a turn. They arrive with Phase 2.
 */

import type { AnyEventHandler } from "../framework/events.ts";
import { autoThread } from "./auto-thread.ts";
import { praise } from "./praise.ts";

export function buildEventHandlers(): readonly AnyEventHandler[] {
  return [praise, autoThread];
}
