/**
 * What the bot has painted into Discord for one delivery.
 *
 * The counterpart to the intent: the agent publishes what it wants shown, this
 * records what is actually on screen. Keeping them apart is what lets a paint be
 * retried without duplicating messages — the projection says which message ids
 * already exist and what they currently say, so a retry edits rather than posts.
 */

import { z } from "zod";

import { contentHash, discordSnowflake } from "../../formats.ts";
import { jsonCodec } from "../../json.ts";
import type { DeliveryPayload, RenderTarget } from "../../wire.ts";

export const renderProjectionSchema = z.object({
  anchorMessageId: discordSnowflake.optional(),
  anchorContentHash: contentHash.optional(),
  /**
   * The message carrying an input request's prose and buttons.
   *
   * Separate from the anchor because the anchor is edited on every streaming
   * tick, and Discord does not notify anyone for an edit — a mention added that
   * way never pings the person being asked for input.
   */
  hitlMessageId: discordSnowflake.optional(),
  hitlContentHash: contentHash.optional(),
  /**
   * Which request `hitlMessageId` is asking about.
   *
   * A turn can ask more than once — an input request, then a tool approval for
   * what the answer led to. A change in this value means "post a new message",
   * not "edit", so the record of what was already answered is not lost.
   */
  hitlRequestKey: z.string().min(1).max(128).optional(),
  /**
   * What a subagent is doing, as read off its own stream.
   *
   * The one bot-owned field here: the agent is suspended while the child runs,
   * which is the whole reason this exists, so the follower writes it and the
   * renderer merges it in. The intent stays the agent's alone.
   */
  subagentActivity: z.string().min(1).max(200).optional(),
  overflow: z
    .array(z.object({ messageId: discordSnowflake, contentHash: contentHash.optional() }))
    .max(10),
  appliedRevision: z.int().nonnegative(),
});

/** One declaration owns both directions, so a bad id fails at the write. */
export const projectionCodec = jsonCodec(renderProjectionSchema);

export type StoredRenderProjection = z.output<typeof renderProjectionSchema>;

/** What the bot has painted. `appliedRevision` is stamped on at write time. */
export type RenderProjection = Omit<StoredRenderProjection, "appliedRevision">;

/**
 * Where a paint ended up.
 *
 * The delivery machine treats both alike: one means Discord shows the final
 * state, the other means it never can. A turn held open waiting for a paint that
 * cannot happen is the wedge this distinction prevents.
 */
export const RenderOutcome = { Applied: "applied", Discarded: "discarded" } as const;
export type RenderOutcome = (typeof RenderOutcome)[keyof typeof RenderOutcome];

/** How long every key in this aggregate lives: intent, target, projection, outcome. */
export const RENDER_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Where a delivery may be painted, fixed at the moment it is queued.
 *
 * Immutable for the life of the delivery, which is what lets a paint retry
 * without re-deriving a channel that may since have changed. Built here rather
 * than in the delivery writer that stores it, so one place owns the shape.
 */
export function renderTargetFor(delivery: DeliveryPayload): RenderTarget {
  return {
    dispatchId: delivery.dispatchId,
    continuationKey: delivery.continuationKey,
    messageId: delivery.messageId,
    channelId: delivery.thread?.id ?? delivery.channel.id,
    authChannelId: delivery.channel.id,
    ...(delivery.thread === undefined ? {} : { authThreadId: delivery.thread.id }),
    requesterUserId: delivery.principal.userId,
    // Without an anchor there is nothing to edit, so the first paint replies to
    // the message that started the turn.
    ...(delivery.anchorMessageId === undefined
      ? { replyToMessageId: delivery.messageId }
      : { anchorMessageId: delivery.anchorMessageId }),
  };
}
