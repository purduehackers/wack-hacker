import type { SimConversation } from "./conversation.ts";

import { bootstrapSimulator } from "./bootstrap.ts";

// The fakes are process-global, so a process holds exactly one active session.
// Switching session id re-bootstraps (re-installs the globals at the new
// session's transports) and discards the previous conversation.
let current: SimConversation | undefined;

export function getOrCreateSession(sessionId: string): SimConversation {
  if (current?.id !== sessionId) current = bootstrapSimulator(sessionId);
  return current;
}

export function getSession(sessionId: string): SimConversation | undefined {
  return current?.id === sessionId ? current : undefined;
}

/** Drop the active session (tests / explicit reset). */
export function resetSessions(): void {
  current = undefined;
}
