/**
 * What the bot has painted into Discord for one delivery.
 *
 * The counterpart to the intent: the agent publishes what it wants shown, this
 * records what is actually on screen. Keeping them apart is what lets a paint be
 * retried without duplicating messages — the projection says which message ids
 * already exist and what they currently say, so a retry edits rather than posts.
 *
 * Everything here except `subagentActivity` is a fact about Discord. That one
 * field is bot-authored content, and it is here rather than in the intent
 * because the agent is suspended for the whole span it describes.
 */

import { z } from "zod";

import { contentHash, discordSnowflake } from "../../formats.ts";
import { jsonCodec } from "../../json.ts";

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
   * what the answer led to. Without an identity here the second question would
   * be edited over the first, and the record of what was already answered would
   * be lost. A change in this value means "post a new message", not "edit".
   */
  hitlRequestKey: z.string().min(1).max(128).optional(),
  /**
   * What a subagent is doing, as read off its own stream.
   *
   * Bot-owned, unlike everything the intent carries. The agent cannot author it
   * — it is suspended while the child runs, which is the whole reason this
   * exists — so the reader that follows the child writes it here and the
   * renderer merges it in. The intent stays the agent's alone.
   */
  subagentActivity: z.string().min(1).max(200).optional(),
  overflow: z
    .array(z.object({ messageId: discordSnowflake, contentHash: contentHash.optional() }))
    .max(10),
  appliedRevision: z.int().nonnegative(),
});

/**
 * One declaration owns both directions of the round trip, so the record cannot
 * be written in a shape its own reader rejects — a bad message id fails at the
 * write instead of poisoning the key until the next read.
 */
export const projectionCodec = jsonCodec(renderProjectionSchema);

export type StoredRenderProjection = z.output<typeof renderProjectionSchema>;

/** What the bot has painted. `appliedRevision` is stamped on at write time. */
export type RenderProjection = Omit<StoredRenderProjection, "appliedRevision">;

/**
 * Where a paint ended up.
 *
 * `applied` and `discarded` are both durable answers, and the delivery machine
 * treats them alike: one means Discord shows the final state, the other means it
 * never can. A turn held open waiting for a paint that cannot happen is the
 * wedge this distinction exists to prevent.
 */
export const RenderOutcome = { Applied: "applied", Discarded: "discarded" } as const;
export type RenderOutcome = (typeof RenderOutcome)[keyof typeof RenderOutcome];

/**
 * How long every key in this aggregate lives: intent, target, projection, outcome.
 *
 * Long enough that a thread reopened next week still shows what was said, and
 * declared once because the alternative is what happened here — the target was
 * written by `enqueue` with no expiry at all, and only ever gained one from a
 * *terminal* paint, so every delivery that ended any other way left a key nothing
 * would collect.
 */
export const RENDER_TTL_SECONDS = 7 * 24 * 60 * 60;
