/**
 * What happened to one component click.
 *
 * Discord retries an interaction webhook, and a retry must not run the turn
 * again. The handler therefore records the answer under the interaction's own
 * id. The identity fields are the fence. A receipt that does not describe
 * *this* click is a different click reusing an id — a conflict rather than a
 * duplicate.
 */

import { z } from "zod";

const identity = {
  dispatchId: z.uuid(),
  renderRevision: z.int().positive(),
  requestId: z.string().min(1).max(128),
  principalId: z.string().min(1).max(32),
  /** A hash of the answer, so freeform text stays out of a coordination record. */
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
