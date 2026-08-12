import { createConversationStore } from "@repo/shared/conversations";
import { getRedis } from "@repo/shared/redis";
import { getVercelOidcToken } from "@vercel/oidc";
import type { SessionAuthContext } from "eve/context";
import { defineHook } from "eve/hooks";
import { z } from "zod";

import { env } from "../env.ts";

/**
 * Publishes the address of the child session a delegated turn is waiting on.
 *
 * A declared subagent runs in its own session. The parent's stream carries only
 * `subagent.called` and `subagent.completed`, and everything between happens on
 * the child's stream — which the parent cannot read, because it is suspended for
 * exactly that span. Something that holds sockets has to read it instead, and
 * this is how that something learns the address.
 *
 * A hook rather than a channel handler because `ChannelEvents` does not carry
 * the subagent events at all; only `HookEventMap` does.
 *
 * Keyed by delivery, not by conversation: the same conversation's next turn
 * delegates separately, and a stale address would have the reader following a
 * child that finished two turns ago.
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
    async "subagent.called"(event, ctx) {
      const dispatchId = dispatchOf(ctx.session.auth.current?.attributes);
      if (dispatchId === undefined) return;
      // Minted here because here is a Vercel function. The reader is not: the
      // bot is a long-lived sandbox process with no Vercel identity of its own,
      // so it cannot ask for one and has to be handed one. Twelve hours covers
      // any delegation, which is why this is a single mint and not a refresh
      // path. A mint that fails costs the progress relay, not the turn.
      const streamToken = await getVercelOidcToken().catch((cause: unknown) => {
        console.warn(
          JSON.stringify({
            event: "subagent.token_unavailable",
            childSessionId: event.data.childSessionId,
            reason: cause instanceof Error ? cause.message : String(cause),
          }),
        );
        return undefined;
      });
      if (streamToken === undefined) return;

      await conversations.subagents.begin(dispatchId, {
        childSessionId: event.data.childSessionId,
        name: event.data.name,
        callId: event.data.callId,
        streamToken,
        startedAt: new Date().toISOString(),
      });
    },

    async "subagent.completed"(_event, ctx) {
      const dispatchId = dispatchOf(ctx.session.auth.current?.attributes);
      if (dispatchId === undefined) return;
      await conversations.subagents.end(dispatchId);
    },
  },
});
