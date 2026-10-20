import type { ConversationStore } from "@repo/shared/conversations";
import type { CancelRequestPayload, CancelResponse } from "@repo/shared/wire";
import type { Session } from "eve/channels";

/**
 * Eve 0.81.1 checks turnId only while a turn is active. Its idle owner can apply
 * an older cancellation to later working tasks or a session-limit prompt.
 * No configuration override: enable only after the installed-runtime regression
 * proves both active and idle owners reject stale target turns.
 */
export const EXACT_TURN_CANCEL_SUPPORTED = false;

/** A fixed Eve handle is the final fence, even if Redis changes after admission. */
export async function cancelDiscordTask(
  cancellations: Pick<ConversationStore["cancellations"], "authorize" | "acknowledge">,
  backend: {
    readonly supported: boolean;
    readonly attachSession: (sessionId: string) => Pick<Session, "cancel">;
  },
  payload: CancelRequestPayload,
): Promise<CancelResponse> {
  if (!backend.supported) return { ok: true, status: "unsupported" };
  const authority = await cancellations.authorize(payload);
  if (authority !== "pending") {
    if (authority !== "busy") await cancellations.acknowledge(payload, authority);
    return { ok: true, status: authority };
  }
  // Public API: the fixed session never follows a replacement; turnId scopes
  // the durable cancel command even if this turn completes during the request.
  const result = await backend
    .attachSession(payload.sessionId)
    .cancel({ turnId: payload.eveTurnId });
  const status = result.status === "accepted" ? "accepted" : "no-active-turn";
  await cancellations.acknowledge(payload, status);
  return { ok: true, status };
}
