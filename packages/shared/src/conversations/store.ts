/**
 * The only Redis-facing API for durable conversation coordination.
 *
 * Every surface is split the same way: a reader that only looks, and a writer
 * that owns every transition of one record. The pairing is the whole design —
 * before it, eleven Lua scripts across three files rewrote the delivery record
 * under six different fences, and most defects here were one of them forgetting
 * an invariant the others remembered.
 *
 * Names are singular for the writer and plural for the reader, so a call site
 * says which it is doing without opening this file.
 */

import type { RedisClient } from "../redis/client.ts";
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
import { AuthorizationReader } from "./readers/authorization.ts";
import { DelegationReader } from "./readers/delegation.ts";
import { DeliveryReader } from "./readers/delivery.ts";
import { InteractionReader } from "./readers/interaction.ts";
import { RenderReader } from "./readers/render.ts";
import { AuthorizationWriter } from "./writers/authorization.ts";
import { DelegationWriter } from "./writers/delegation.ts";
import { DeliveryWriter } from "./writers/delivery.ts";
import { HitlWriter } from "./writers/hitl.ts";
import { InteractionWriter } from "./writers/interaction.ts";
import { RenderWriter } from "./writers/render.ts";
import { ScheduleWriter } from "./writers/schedule.ts";

export function createConversationStore(deps: { readonly redis: RedisClient }) {
  const { redis } = deps;
  const deliveries = new DeliveryReader(redis);
  return {
    /** A turn's hold on one conversation: queue, admission, park, release. */
    deliveries,
    delivery: new DeliveryWriter(redis),
    /** What should be on screen, and what is. */
    renders: new RenderReader(redis),
    render: new RenderWriter(redis),
    /** One component click, and the receipt that makes its retry idempotent. */
    interactions: new InteractionReader(redis),
    interaction: new InteractionWriter(redis),
    /** Which child session a delegated turn is waiting on. */
    delegations: new DelegationReader(redis),
    delegation: new DelegationWriter(redis),
    /** Third-party consent challenges hanging off a dispatch. */
    authorizationChallenges: new AuthorizationReader(redis),
    authorizations: new AuthorizationWriter(redis),
    /** Write-only surfaces: nothing outside their own scripts reads them. */
    hitl: new HitlWriter(redis),
    schedules: new ScheduleWriter(redis),

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
      const record = await deliveries.read(continuationKey);
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
