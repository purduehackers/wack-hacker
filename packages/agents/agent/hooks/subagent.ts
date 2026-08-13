/**
 * Announces that this turn has handed work to a subagent, and hands over a token
 * for reading its stream.
 *
 * A delegated turn goes silent from outside: the parent suspends while the child
 * runs, publishes no renders, and is reclaimed by the sweep as though it had died.
 * Something has to watch, and the only side that can hold a stream is the bot —
 * which has no Vercel identity of its own, so the token is minted here, inside a
 * function, and left where the bot will look.
 *
 * **On `actions.requested`, not `subagent.called`.** The latter never reaches a
 * hook: eve dispatches it through `callAdapterEventHandler` to the channel adapter
 * and onto the parent's event stream, and authored `ChannelEvents` does not carry
 * it either. A probe on both settled it.
 *
 * That costs the child's session id, which exists only on the stream — and the
 * child is where the work happens, since eve publishes a delegated subagent's
 * progress on its own child-session stream. So this records the parent, and the
 * bot reads `childSessionId` off the parent's stream where the hook could not.
 */

import { createConversationStore } from "@repo/shared/conversations";
import { messageOf } from "@repo/shared/errors";
import { getRedis } from "@repo/shared/redis";
import { getVercelOidcToken } from "@vercel/oidc";
import type { SessionAuthContext } from "eve/context";
import { defineHook } from "eve/hooks";
import type { HookEventMap } from "eve/hooks";
import { z } from "zod";

import { env } from "../env.ts";

const conversations = createConversationStore({
  redis: getRedis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  }),
});

const presentAttribute = z.string().trim().min(1);

function dispatchOf(attributes: SessionAuthContext["attributes"] | undefined): string | undefined {
  if (attributes === undefined) return undefined;
  return presentAttribute.safeParse(attributes["discordDispatchId"]).data;
}

type RequestedAction = HookEventMap["actions.requested"]["data"]["actions"][number];

/**
 * The first delegation in this step, and what to call it in the channel.
 *
 * One pass rather than filter-then-narrow: the two delegating kinds name
 * themselves differently, so finding one and reading its name is the same
 * question asked once.
 */
function firstDelegation(
  requested: readonly RequestedAction[],
): { readonly callId: string; readonly name: string } | undefined {
  for (const action of requested) {
    if (action.kind === "subagent-call") {
      return { callId: action.callId, name: action.subagentName };
    }
    if (action.kind === "remote-agent-call") {
      return { callId: action.callId, name: action.remoteAgentName };
    }
  }
  return undefined;
}

export default defineHook({
  events: {
    async "actions.requested"(event, ctx) {
      const delegation = firstDelegation(event.data.actions);
      if (delegation === undefined) return;

      const dispatchId = dispatchOf(ctx.session.auth.current?.attributes);
      if (dispatchId === undefined) return;

      // A mint that fails costs the watch, not the turn.
      const streamToken = await getVercelOidcToken().catch((cause: unknown) => {
        console.warn(
          JSON.stringify({ event: "subagent.token_unavailable", reason: messageOf(cause) }),
        );
        return undefined;
      });
      if (streamToken === undefined) return;

      await conversations.delegation.begin(dispatchId, {
        ...delegation,
        sessionId: ctx.session.id,
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
