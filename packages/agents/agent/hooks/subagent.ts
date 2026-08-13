import { createConversationStore } from "@repo/shared/conversations";
import { getRedis } from "@repo/shared/redis";
import { getVercelOidcToken } from "@vercel/oidc";
import type { SessionAuthContext } from "eve/context";
import { defineHook } from "eve/hooks";
import { z } from "zod";

import { env } from "../env.ts";

/**
 * Announces that this turn has handed work to a subagent, and hands over a
 * token for reading its stream.
 *
 * A delegated turn goes silent from outside: the parent suspends while the child
 * runs, publishes no renders, and is reclaimed by the sweep as though it had
 * died. Something has to watch, and the only side that can hold a stream is the
 * bot — which has no Vercel identity of its own, so the token is minted here,
 * inside a function, and left where the bot will look.
 *
 * **On `actions.requested`, not `subagent.called`.** The latter never reaches a
 * hook: eve dispatches it through `callAdapterEventHandler` to the channel
 * adapter and onto the parent's event stream, and authored `ChannelEvents` does
 * not carry it either. A probe on both settled it — `actions.requested` fires
 * with `kind: "subagent-call"`, and `subagent.called` does not fire at all.
 *
 * That costs the child's session id, which is only on the stream. It is not
 * needed: the parent's own stream carries the delegation's boundaries, and the
 * parent session id is already on the active record. The bot follows the parent.
 */

const conversations = createConversationStore({
  redis: getRedis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
});

type AuthAttributes = SessionAuthContext["attributes"];

const presentAttribute = z.string().trim().min(1);

function dispatchOf(attributes: AuthAttributes | undefined): string | undefined {
  if (attributes === undefined) return undefined;
  return presentAttribute.safeParse(attributes["discordDispatchId"]).data;
}

export default defineHook({
  events: {
    async "actions.requested"(event, ctx) {
      const delegated = event.data.actions.filter(
        (action) => action.kind === "subagent-call" || action.kind === "remote-agent-call",
      );
      if (delegated.length === 0) return;

      const dispatchId = dispatchOf(ctx.session.auth.current?.attributes);
      if (dispatchId === undefined) return;

      // A mint that fails costs the watch, not the turn.
      const streamToken = await getVercelOidcToken().catch((cause: unknown) => {
        console.warn(
          JSON.stringify({
            event: "subagent.token_unavailable",
            reason: cause instanceof Error ? cause.message : String(cause),
          }),
        );
        return undefined;
      });
      if (streamToken === undefined) return;

      const first = delegated[0];
      await conversations.delegation.begin(dispatchId, {
        sessionId: ctx.session.id,
        name:
          first?.kind === "subagent-call"
            ? first.subagentName
            : first?.kind === "remote-agent-call"
              ? first.remoteAgentName
              : "subagent",
        callId: first?.callId ?? "unknown",
        streamToken,
        startedAt: new Date().toISOString(),
      });
    },

    async "turn.completed"(_event, ctx) {
      const dispatchId = dispatchOf(ctx.session.auth.current?.attributes);
      if (dispatchId === undefined) return;
      await conversations.delegation.end(dispatchId);
    },
  },
});
