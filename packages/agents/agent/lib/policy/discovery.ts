import { Result } from "@repo/shared/result";
import type { SessionAuthContext } from "eve/context";

import { decideCapability } from "./engine.ts";
import { requirePrincipal } from "./principal.ts";
import type { CapabilityDescriptor } from "./types.ts";

/**
 * Whether this principal may discover a subagent.
 *
 * Discovery is a function of role policy: an unauthenticated delivery and a
 * principal whose policy withholds discovery are both simply "not discoverable".
 * That keeps every resolver to a single hidden-capability exit.
 *
 * Every `subagents/<domain>/agent.ts` calls this rather than inlining the
 * `requirePrincipal` → `decideCapability` → `.discover` sequence. So the gate
 * cannot drift between domains — one of them getting this subtly wrong would be
 * invisible in review.
 */
export function subagentDiscoverable(
  current: SessionAuthContext | null | undefined,
  descriptor: CapabilityDescriptor,
): boolean {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return false;
  const decision = decideCapability(principal.value, descriptor);
  return !Result.isError(decision) && decision.value.discover;
}
