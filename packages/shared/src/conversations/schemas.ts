/** Persisted record shapes private to conversation coordination. */

import { z } from "zod";

import {
  deliveryPayloadSchema,
  parkedPayloadSchema,
  renderIntentSchema,
  renderTargetSchema,
} from "../wire.ts";

export { deliveryPayloadSchema, parkedPayloadSchema, renderIntentSchema, renderTargetSchema };

export const activeDeliverySchema = z.looseObject({
  phase: z.enum(["claimed", "live", "parked", "recovery-required"]),
  ownerToken: z.string(),
  deliveryLeaseUntilMs: z.number(),
  messageId: z.string(),
  dispatchId: z.uuid(),
  sessionId: z.string(),
  deliveryRaw: z.string(),
  admissionAttemptId: z.string().optional(),
  eveTurnId: z.string().optional(),
  recoveryReported: z.boolean().optional(),
});

const contentHashSchema = z.string().regex(/^[A-Za-z0-9_-]{16}$/);
export const renderProjectionSchema = z.object({
  anchorMessageId: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional(),
  anchorContentHash: contentHashSchema.optional(),
  overflow: z
    .array(
      z.object({
        messageId: z.string().regex(/^\d{17,20}$/),
        contentHash: contentHashSchema.optional(),
      }),
    )
    .max(10),
  appliedRevision: z.number().int().nonnegative(),
});

export const hitlClaimSchema = z.looseObject({
  revision: z.number().int().positive(),
  requestId: z.string(),
  interactionId: z.string(),
  status: z.enum(["forwarding", "accepted"]),
});

const interactionReceiptIdentitySchema = z.looseObject({
  dispatchId: z.uuid(),
  renderRevision: z.number().int().positive(),
  requestId: z.string(),
  principalId: z.string(),
  responseDigest: z.string(),
  authChannelId: z.string(),
  authThreadId: z.string().optional(),
});
export const interactionReceiptSchema = z.discriminatedUnion("status", [
  interactionReceiptIdentitySchema.extend({ status: z.literal("forwarding") }),
  interactionReceiptIdentitySchema.extend({
    status: z.literal("accepted"),
    sessionId: z.string(),
    continuationToken: z.string(),
  }),
]);

const scheduledFireIdentitySchema = z.looseObject({
  scheduleId: z.uuid(),
  ownerId: z.string(),
  channelId: z.string(),
  actionType: z.enum(["agent", "message"]),
});
export const scheduledFireReceiptSchema = z.discriminatedUnion("status", [
  scheduledFireIdentitySchema.extend({ status: z.literal("forwarding"), claimToken: z.string() }),
  scheduledFireIdentitySchema.extend({ status: z.literal("accepted") }),
]);

export const renderOutcomeSchema = z.enum(["applied", "discarded"]);

export interface RenderProjection {
  anchorMessageId?: string;
  anchorContentHash?: string;
  overflow: { messageId: string; contentHash?: string }[];
}

export type ActiveDelivery = z.infer<typeof activeDeliverySchema>;
export type StoredRenderProjection = z.infer<typeof renderProjectionSchema>;
export type HitlClaimRecord = z.infer<typeof hitlClaimSchema>;
export type InteractionReceipt = z.infer<typeof interactionReceiptSchema>;
export type InteractionReceiptIdentity = Omit<
  z.infer<typeof interactionReceiptIdentitySchema>,
  "status"
>;
export type ScheduledFireReceipt = z.infer<typeof scheduledFireReceiptSchema>;
