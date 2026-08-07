/** The only Redis-facing API for durable conversation coordination. */

import type { RedisClient } from "../redis/client.ts";
import { createAdmissionTransitions } from "./admission.ts";
import { createAuthorizationTransitions } from "./authorization.ts";
import { createHitlTransitions } from "./hitl.ts";
import { createInteractionTransitions } from "./interaction.ts";
import {
  activeKey,
  AGENT_READY_SET_KEY,
  AGENT_RENDER_READY_SET_KEY,
  ingressKey,
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
import { createQueueTransitions } from "./queue.ts";
import { createRenderPublicationTransitions } from "./render-publication.ts";
import { createRenderTransitions } from "./render.ts";
import { createScheduledFireTransitions } from "./scheduled-fire.ts";

export interface ConversationStoreDeps {
  readonly redis: RedisClient;
  readonly newToken?: () => string;
  readonly now?: () => number;
}

export function createConversationStore(deps: ConversationStoreDeps) {
  const { redis } = deps;
  return {
    queue: createQueueTransitions(deps),
    admission: createAdmissionTransitions(redis),
    render: createRenderTransitions(redis),
    renderPublication: createRenderPublicationTransitions(redis),
    hitl: createHitlTransitions(redis),
    interactions: createInteractionTransitions(redis),
    authorizations: createAuthorizationTransitions(redis),
    scheduledFires: createScheduledFireTransitions(redis),

    resetCutoverStatus: async (
      continuationKey: string,
      resetId: string,
    ): Promise<"ready" | "stale" | "busy"> => {
      const [owner, admission] = await Promise.all([
        redis.get(resetKey(continuationKey)),
        redis.get(ingressKey(continuationKey)),
      ]);
      if (owner !== resetId) return "stale";
      return admission === null || admission === undefined ? "ready" : "busy";
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
      const [depth, active, parked, ingress, reset, resetPending, ready] = await Promise.all([
        redis.llen(pendingKey(continuationKey)),
        redis.get(activeKey(continuationKey)),
        redis.get(parkedKey(continuationKey)),
        redis.exists(ingressKey(continuationKey)),
        redis.exists(resetKey(continuationKey)),
        redis.llen(resetPendingKey(continuationKey)),
        redis.sismember(AGENT_READY_SET_KEY, queueMember(continuationKey)),
      ]);
      return { depth, active, parked, ingress, reset, resetPending, ready };
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
