/**
 * What happened to one component click.
 *
 * Discord retries an interaction webhook, and a retry must not run the turn
 * again — so the answer is written down under the interaction's own id and the
 * retry is answered from the record. The identity fields are the fence: a receipt
 * that does not describe *this* click is a different click reusing an id, which
 * is a conflict rather than a duplicate.
 *
 * `forwarding` is written when the click is admitted and `accepted` replaces it
 * once eve has answered, which is why only the second carries a session. A retry
 * landing on `forwarding` is told to wait; one landing on `accepted` gets the
 * original answer replayed verbatim.
 */

import { z } from "zod";

const identity = {
  dispatchId: z.uuid(),
  renderRevision: z.int().positive(),
  requestId: z.string().min(1).max(128),
  principalId: z.string().min(1).max(32),
  /**
   * A hash of the answer, not the answer.
   *
   * Enough to tell "the same click again" from "a different click reusing this
   * id", without a person's freeform text sitting in a coordination record.
   */
  responseDigest: z.string().min(1).max(128),
  authChannelId: z.string().min(1).max(32),
  authThreadId: z.string().min(1).max(32).optional(),
};

export const interactionReceiptSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("forwarding"), ...identity }),
  z.object({
    status: z.literal("accepted"),
    ...identity,
    sessionId: z.string().min(1).max(128),
    continuationToken: z.string().min(1),
  }),
]);

export type InteractionReceipt = z.output<typeof interactionReceiptSchema>;

/** The fence, without the outcome — what a claim computes before it knows one. */
export type InteractionIdentity = Omit<
  Extract<InteractionReceipt, { status: "forwarding" }>,
  "status"
>;

/** Receipts outlive any plausible Discord retry, and no longer. */
export const RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;
