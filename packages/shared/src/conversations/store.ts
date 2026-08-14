/**
 * The only Redis-facing API for durable conversation coordination.
 *
 * Every surface is split the same way: a reader that only looks, and a writer
 * that owns every transition of one record. Names are plural for the reader and
 * singular for the writer, so a call site says which it does.
 */

import type { RedisClient } from "../redis/client.ts";
import { resetKey } from "./keys.ts";
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

/**
 * Builds every reader and writer over one shared Redis client.
 *
 * The object shape is the API: plural names only read, singular names own
 * writes, so a caller states its intent by the surface it picks.
 */
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
    /** Which child session a delegated turn waits on. */
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
     * `busy` means a delivery is mid-flight into eve. That state is a lease on
     * the record, not a second key that someone must keep in step with it.
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
  };
}

export type ConversationStore = ReturnType<typeof createConversationStore>;
