/** The only Redis-facing API for durable conversation coordination. */

import type { RedisClient } from "../redis/client.ts";
import { createAuthorizationTransitions } from "./authorization.ts";
import { createHitlTransitions } from "./hitl.ts";
import { createInteractionTransitions } from "./interaction.ts";
import {
  activeKey,
  AGENT_READY_SET_KEY,
  AGENT_RENDER_READY_SET_KEY,
  parkedKey,
  pendingKey,
  QUEUE_INDEX_KEY,
  queueMember,
  renderClaimKey,
  renderIntentKey,
  renderMember,
  renderOutcomeKey,
  renderProjectionKey,
  renderTargetKey,
  resetKey,
  resetPendingKey,
} from "./keys.ts";
import { DeliveryReader } from "./readers/delivery.ts";
import { createRenderPublicationTransitions } from "./render-publication.ts";
import { createRenderTransitions } from "./render.ts";
import { createScheduledFireTransitions } from "./scheduled-fire.ts";
import { createSubagentTransitions } from "./subagents.ts";
import { DeliveryWriter } from "./writers/delivery.ts";

export function createConversationStore(deps: { readonly redis: RedisClient }) {
  const { redis } = deps;
  return {
    /**
     * The delivery lifecycle, split so a lookup cannot become a transition.
     *
     * Replaces `queue` and `admission`, which between them held ten Lua scripts
     * and five ways of expressing a hold. Callers that only look go through
     * `deliveries`; callers that change something go through `delivery`.
     */
    deliveries: new DeliveryReader(redis),
    delivery: new DeliveryWriter(redis),
    subagents: createSubagentTransitions(redis),
    render: createRenderTransitions(redis),
    renderPublication: createRenderPublicationTransitions(redis),
    hitl: createHitlTransitions(redis),
    interactions: createInteractionTransitions(redis),
    authorizations: createAuthorizationTransitions(redis),
    scheduledFires: createScheduledFireTransitions(redis),

    /**
     * Whether a reset may proceed.
     *
     * `busy` means a delivery is mid-flight into eve. That used to be a separate
     * `agent:ingress:<key>`; it is now a lease on the record, so this reads the
     * record rather than a second key that had to be kept in step with it.
     */
    resetCutoverStatus: async (
      continuationKey: string,
      resetId: string,
    ): Promise<"ready" | "stale" | "busy"> => {
      const owner = await redis.get(resetKey(continuationKey));
      if (owner !== resetId) return "stale";
      const record = await new DeliveryReader(redis).read(continuationKey);
      if (record?.ingress === undefined) return "ready";
      return record.ingress.expiresAtMs > Date.now() ? "busy" : "ready";
    },

    inspectIndexes: async () => {
      const [conversations, ready, renderReady] = await Promise.all([
        redis.scard(QUEUE_INDEX_KEY),
        redis.scard(AGENT_READY_SET_KEY),
        redis.scard(AGENT_RENDER_READY_SET_KEY),
      ]);
      return { conversations, ready, renderReady };
    },

    inspectConversation: async (continuationKey: string) => {
      const [depth, active, parked, reset, resetPending, ready] = await Promise.all([
        redis.llen(pendingKey(continuationKey)),
        redis.get(activeKey(continuationKey)),
        redis.get(parkedKey(continuationKey)),
        redis.exists(resetKey(continuationKey)),
        redis.llen(resetPendingKey(continuationKey)),
        redis.sismember(AGENT_READY_SET_KEY, queueMember(continuationKey)),
      ]);
      return { depth, active, parked, reset, resetPending, ready };
    },

    inspectRender: async (dispatchId: string) => {
      const [ready, target, intent, projection, claim, claimTtlMs, outcome] = await Promise.all([
        redis.sismember(AGENT_RENDER_READY_SET_KEY, renderMember(dispatchId)),
        redis.exists(renderTargetKey(dispatchId)),
        redis.exists(renderIntentKey(dispatchId)),
        redis.exists(renderProjectionKey(dispatchId)),
        redis.exists(renderClaimKey(dispatchId)),
        redis.pttl(renderClaimKey(dispatchId)),
        redis.get(renderOutcomeKey(dispatchId)),
      ]);
      return { ready, target, intent, projection, claim, claimTtlMs, outcome };
    },
  };
}

export type ConversationStore = ReturnType<typeof createConversationStore>;
