import { createHmac } from "node:crypto";

import { z } from "zod";

import { eventSchema, personSchema, reviewSchema, criteria, settingsSchema } from "./contracts.ts";

export const actionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("roles"), badge: z.int().min(0).max(1) }),
  z.strictObject({ kind: z.literal("replace"), role: z.enum(["badge", "stamp"]) }),
  z.strictObject({ kind: z.literal("event"), id: z.string().min(1).max(128) }),
  z.strictObject({ kind: z.literal("settings"), value: settingsSchema }),
  z.strictObject({ kind: z.literal("layout"), id: z.string().min(1).max(64) }),
  z.strictObject({
    kind: z.literal("decision"),
    criterion: z.enum(criteria),
    verdict: z.enum(["approve", "changes", "unclear"]),
    note: z.string().trim().max(1500),
  }),
  z.strictObject({ kind: z.enum(["publish", "retry", "refresh"]) }),
]);
export type Action = z.output<typeof actionSchema>;

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
export const cardSchema = z.strictObject({
  review: reviewSchema,
  version: z.int(),
  events: z.array(eventSchema),
  files: z.array(z.strictObject({ name: z.string(), data: z.string() })),
  jobId: z.string(),
  lease: z.uuid(),
});
export const workResponse = z.strictObject({ card: cardSchema.optional() });
