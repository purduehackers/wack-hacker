import { createHash } from "node:crypto";

import { z } from "zod";

export const BADGES_CHANNEL_ID = "1418162647005790342";
export const RUBRIC_VERSION = "2026-10-12.1";
export const MAX_SVG_BYTES = 1_000_000;
export const MIN_BADGE_LONG_SIDE_IN = 2;
export const MIN_BADGE_SHORT_SIDE_IN = 1.7;
const id = z.string().trim().min(1).max(128);
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const personSchema = z.strictObject({ id, username: z.string().trim().min(1).max(64) });
export const assetSchema = z.strictObject({ hash: digestSchema, name: z.string().max(256) });
export const eventSchema = z.strictObject({
  id,
  slug: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/u),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+$/u),
  date: z.iso.date(),
});
export const settingsSchema = z
  .strictObject({
    material: z.string().trim().min(1).max(100),
    minSizeIn: z.number().min(MIN_BADGE_LONG_SIDE_IN).max(10),
    maxSizeIn: z.number().min(MIN_BADGE_LONG_SIDE_IN).max(10),
    stampSizeIn: z.number().positive().max(1.5),
    mirrorStamp: z.boolean(),
    gapMm: z.number().min(0.2).max(5),
  })
  .refine((s) => s.maxSizeIn >= s.minSizeIn, {
    path: ["maxSizeIn"],
    message: "Maximum size must be at least the minimum size.",
  });
export const criteria = ["version", "date", "physical", "stamp"] as const;
export const criterionSchema = z.enum(criteria);
export const checkIds = ["supported", "palette", "vectors", "text", "fills", "cut"] as const;
export const checkSchema = z.strictObject({
  id: z.enum(checkIds),
  role: z.enum(["badge", "stamp"]),
  status: z.enum(["pass", "fail", "unknown"]),
  detail: z.string().max(3000),
  evidenceId: digestSchema,
});
export const placementSchema = z.strictObject({
  sheet: z.int().min(0).max(1),
  x: z.number(),
  y: z.number(),
  angle: z.number(),
});
export const layoutSchema = z.strictObject({
  id: digestSchema,
  count: z.int().min(80).max(100),
  sizeIn: z.number().min(MIN_BADGE_LONG_SIDE_IN),
  widthIn: z.number().min(MIN_BADGE_SHORT_SIDE_IN),
  heightIn: z.number().min(MIN_BADGE_SHORT_SIDE_IN),
  placements: z.array(placementSchema).max(100),
  sheets: z.array(digestSchema).length(2),
  preview: digestSchema,
  audited: z.literal(true),
});
export const decisionSchema = z.strictObject({
  criterion: criterionSchema,
  context: digestSchema,
  verdict: z.enum(["approve", "changes", "unclear"]),
  reviewer: personSchema,
  note: z.string().max(1500),
  at: z.iso.datetime(),
});
export const reviewSchema = z.strictObject({
  id,
  threadId: id,
  sourceMessageId: id,
  author: personSchema,
  generation: z.int().nonnegative(),
  rubric: z.literal(RUBRIC_VERSION),
  uploads: z.array(assetSchema).min(1).max(2),
  rolesConfirmed: z.boolean(),
  badge: assetSchema.optional(),
  stamp: assetSchema.optional(),
  event: eventSchema.optional(),
  settings: settingsSchema.optional(),
  checks: z.array(checkSchema),
  previews: z.array(digestSchema),
  layouts: z.array(layoutSchema).max(3),
  selectedLayout: digestSchema.optional(),
  manufacturing: z
    .strictObject({ badge: digestSchema, stamp: digestSchema, stampPreview: digestSchema })
    .optional(),
  decisions: z.array(decisionSchema),
  repositoryHead: z.string().optional(),
  pr: z.strictObject({ number: z.int().positive(), head: z.string(), url: z.url() }).optional(),
  approval: z
    .strictObject({ context: digestSchema, head: z.string(), reviewer: personSchema })
    .optional(),
  publication: z
    .strictObject({ commit: z.string(), url: z.url(), shortlink: z.url().optional() })
    .optional(),
  failure: z.string().max(1500).optional(),
  cardId: id.optional(),
});
export type Review = z.output<typeof reviewSchema>;
export type Person = z.output<typeof personSchema>;
export type BadgeEvent = z.output<typeof eventSchema>;
export type Asset = z.output<typeof assetSchema>;
export type Settings = z.output<typeof settingsSchema>;
export type Check = z.output<typeof checkSchema>;
export type Layout = z.output<typeof layoutSchema>;
export type Criterion = z.output<typeof criterionSchema>;
export type Decision = z.output<typeof decisionSchema>;
export type StoredReview = { review: Review; version: number };
export type JobKind = "inspect" | "pack" | "prepare" | "archive" | "publish" | "render";
export const jobKindSchema = z.enum(["inspect", "pack", "prepare", "archive", "publish", "render"]);

export function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function contextHash(review: Review): string {
  return hash(
    JSON.stringify({
      badge: review.badge?.hash,
      stamp: review.stamp?.hash,
      event: review.event,
      settings: review.settings,
      layout: review.selectedLayout,
      manufacturing: review.manufacturing,
      rubric: review.rubric,
    }),
  );
}

export function staticPassed(review: Review): boolean {
  return ["badge", "stamp"].every((role) =>
    checkIds.every((id) =>
      review.checks.some(
        (check) =>
          check.role === role &&
          check.id === id &&
          check.status === "pass" &&
          check.evidenceId === (role === "badge" ? review.badge?.hash : review.stamp?.hash),
      ),
    ),
  );
}

export function remainingCriteria(review: Review): Criterion[] {
  const context = contextHash(review);
  return criteria.filter(
    (criterion) =>
      !review.decisions.some(
        (decision) =>
          decision.context === context &&
          decision.criterion === criterion &&
          decision.verdict === "approve",
      ),
  );
}

export function reviewable(review: Review): boolean {
  return (
    review.rolesConfirmed &&
    staticPassed(review) &&
    review.event !== undefined &&
    review.settings !== undefined &&
    review.manufacturing !== undefined &&
    review.layouts.some((layout) => layout.id === review.selectedLayout && layout.audited)
  );
}

export function ready(review: Review): boolean {
  return reviewable(review) && remainingCriteria(review).length === 0 && review.pr !== undefined;
}

export function invalidate(review: Review): Review {
  const {
    approval: _approval,
    pr: _pr,
    publication: _publication,
    failure: _failure,
    selectedLayout: _selectedLayout,
    manufacturing: _manufacturing,
    ...rest
  } = review;
  return {
    ...rest,
    generation: review.generation + 1,
    checks: [],
    previews: [],
    layouts: [],
    decisions: [],
  };
}
