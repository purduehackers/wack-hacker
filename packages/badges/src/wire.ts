import { createHmac } from "node:crypto";

import { z } from "zod";

import {
  badgeMaterialSchema,
  eventSchema,
  personSchema,
  reviewSchema,
  criteria,
  MAX_SVG_BYTES,
  targetCountSchema,
} from "./contracts.ts";

const commonActions = [
  z.strictObject({ kind: z.literal("roles"), badge: z.int().min(0).max(1) }),
  z.strictObject({ kind: z.literal("replace"), role: z.enum(["badge", "stamp"]) }),
  z.strictObject({ kind: z.literal("event"), id: z.string().min(1).max(128) }),
  z.strictObject({ kind: z.literal("material"), id: z.string().min(1).max(100) }),
  z.strictObject({ kind: z.literal("quantity"), count: targetCountSchema.optional() }),
  z.strictObject({
    kind: z.literal("decision"),
    criterion: z.enum(criteria),
    verdict: z.enum(["approve", "changes", "unclear"]),
    note: z.string().trim().max(1500),
  }),
  z.strictObject({
    kind: z.enum(["publish", "retry", "refresh", "repack", "choose-material", "keep-design"]),
  }),
] as const;
export const actionSchema = z.discriminatedUnion("kind", [
  ...commonActions,
  z.strictObject({
    kind: z.literal("upload"),
    role: z.enum(criteria),
    file: z
      .strictObject({
        url: z.url(),
        filename: z.string().max(256),
        size: z.int().positive().max(MAX_SVG_BYTES),
      })
      .optional(),
  }),
]);
export type Action = z.output<typeof actionSchema>;

export function actionName(action: Action): string {
  switch (action.kind) {
    case "decision":
      return `review.${action.criterion}.${action.verdict}`;
    case "upload":
      return `upload.${action.role}`;
    case "replace":
      return `replace.${action.role}`;
    case "roles":
      return `roles.${action.badge}`;
    default:
      return action.kind;
  }
}

export function componentId(id: string, version: number, action: string, secret: string): string {
  const data = `badge:${id}:${version}:${action}`;
  return `${data}:${createHmac("sha256", secret).update(data).digest("base64url").slice(0, 16)}`;
}
export const actorSchema = z.strictObject({
  person: personSchema,
  memberRoles: z.array(z.string()).max(100),
  threadId: z.string(),
  guildId: z.string(),
});
export const actionRequest = z.strictObject({
  id: z.uuid(),
  version: z.int().nonnegative(),
  control: z.string().max(100),
  actor: actorSchema,
  action: actionSchema,
  eventId: z.string().min(1),
});
const previewFileSchema = z.strictObject({ name: z.string(), data: z.string() });
export const cardSchema = z.strictObject({
  review: reviewSchema,
  version: z.int(),
  events: z.array(eventSchema),
  materials: z.array(badgeMaterialSchema).default([]),
  files: z.array(previewFileSchema).max(1),
  identifiedFile: previewFileSchema.optional(),
  viewerUrl: z.url().optional(),
  jobId: z.string(),
  lease: z.uuid(),
});
export const workResponse = z.strictObject({
  card: cardSchema.optional(),
  worked: z.boolean().optional(),
});
