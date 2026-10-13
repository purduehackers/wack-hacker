import { randomUUID } from "node:crypto";

import { badgeAssets, badgeEvents, badgeInbox, badgeJobs, badgeReviews } from "@repo/shared/db";
import type { Db } from "@repo/shared/db";
import { and, eq, lte, sql } from "drizzle-orm";

import { hash, jobKindSchema, reviewSchema } from "./contracts.ts";
import type { JobKind, Review, StoredReview } from "./contracts.ts";

export class StaleReview extends Error {
  constructor() {
    super("There’s a newer step in this thread. Use the latest message to continue.");
  }
}
interface Save {
  review: Review;
  expected?: number;
  eventId: string;
  actorId: string;
  jobs: JobKind[];
}

class BadgeRepository {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  async get(id: string): Promise<StoredReview | undefined> {
    const [row] = await this.db.select().from(badgeReviews).where(eq(badgeReviews.id, id)).limit(1);
    return row
      ? { review: reviewSchema.parse(JSON.parse(row.document)), version: row.version }
      : undefined;
  }
  async forThread(threadId: string): Promise<StoredReview | undefined> {
    const [row] = await this.db
      .select()
      .from(badgeReviews)
      .where(eq(badgeReviews.threadId, threadId))
      .limit(1);
    return row
      ? { review: reviewSchema.parse(JSON.parse(row.document)), version: row.version }
      : undefined;
  }
  async asset(digest: string) {
    const [asset] = await this.db
      .select()
      .from(badgeAssets)
      .where(eq(badgeAssets.hash, digest))
      .limit(1);
    if (!asset) throw new Error("Evidence artifact is unavailable.");
    return { bytes: Buffer.from(asset.data, "base64"), mediaType: asset.mediaType };
  }
  async putAsset(bytes: Uint8Array, mediaType: string) {
    if (bytes.byteLength > 3_000_000)
      throw new Error("Generated artifact exceeds the storage limit.");
    const digest = hash(bytes);
    await this.db
      .insert(badgeAssets)
      .values({
        hash: digest,
        mediaType,
        data: Buffer.from(bytes).toString("base64"),
        createdAt: Date.now(),
      })
      .onConflictDoNothing();
    return digest;
  }
  async stage(id: string, threadId: string, document: string) {
    await this.db
      .insert(badgeInbox)
      .values({ id, threadId, document, createdAt: Date.now() })
      .onConflictDoNothing();
  }
  async inbox(id: string, threadId: string) {
    const [row] = await this.db
      .select()
      .from(badgeInbox)
      .where(and(eq(badgeInbox.id, id), eq(badgeInbox.threadId, threadId)))
      .limit(1);
    return row?.document;
  }
  async hasEvent(id: string) {
    const rows = await this.db
      .select({ id: badgeEvents.id })
      .from(badgeEvents)
      .where(eq(badgeEvents.id, id))
      .limit(1);
    return rows.length > 0;
  }
  async save(input: Save) {
    const document = JSON.stringify(reviewSchema.parse(input.review));
    const version = (input.expected ?? -1) + 1;
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(badgeEvents)
        .where(eq(badgeEvents.id, input.eventId))
        .limit(1);
      if (existing) return false;
      if (input.expected === undefined) {
        await tx.insert(badgeReviews).values({
          id: input.review.id,
          threadId: input.review.threadId,
          version,
          document,
          updatedAt: Date.now(),
        });
      } else {
        const rows = await tx
          .update(badgeReviews)
          .set({
            version,
            // Delivery receipts may advance without changing the workflow version.
            document: sql`json_patch(${document}, json_object(
              'cardId', json_extract(${badgeReviews.document}, '$.cardId'),
              'cardVersion', json_extract(${badgeReviews.document}, '$.cardVersion')
            ))`,
            updatedAt: Date.now(),
          })
          .where(
            and(eq(badgeReviews.id, input.review.id), eq(badgeReviews.version, input.expected)),
          )
          .returning({ id: badgeReviews.id });
        if (rows.length === 0) throw new StaleReview();
      }
      await tx.insert(badgeEvents).values({
        id: input.eventId,
        reviewId: input.review.id,
        actorId: input.actorId,
        document,
        createdAt: Date.now(),
      });
      for (const kind of new Set([...input.jobs, "render"]))
        await tx
          .insert(badgeJobs)
          .values({
            id: `${input.review.id}:${kind}:${version}`,
            reviewId: input.review.id,
            generation: input.review.generation,
            kind,
            availableAt: Date.now(),
          })
          .onConflictDoNothing();
      return true;
    });
  }
  async claim(render = false) {
    const now = Date.now();
    // Different revisions of the same review must not publish concurrently.
    // Card delivery can run alongside business work, but not another card delivery.
    const idle = sql`NOT EXISTS (
      SELECT 1 FROM badge_jobs AS active
      WHERE active.review_id = ${badgeJobs.reviewId}
        AND active.state = 'pending' AND active.lease_until > ${now}
        AND (active.kind = 'render') = ${Number(render)}
    )`;
    const [job] = await this.db
      .select()
      .from(badgeJobs)
      .where(
        and(
          eq(badgeJobs.state, "pending"),
          render ? eq(badgeJobs.kind, "render") : sql`${badgeJobs.kind} != 'render'`,
          lte(badgeJobs.availableAt, now),
          lte(badgeJobs.leaseUntil, now),
          idle,
        ),
      )
      .orderBy(badgeJobs.availableAt)
      .limit(1);
    if (!job) return undefined;
    const lease = randomUUID();
    const claimed = await this.db
      .update(badgeJobs)
      .set({ lease, leaseUntil: now + 180_000, attempts: sql`${badgeJobs.attempts} + 1` })
      .where(
        and(
          eq(badgeJobs.id, job.id),
          eq(badgeJobs.state, "pending"),
          lte(badgeJobs.leaseUntil, now),
          idle,
        ),
      )
      .returning();
    if (claimed.length === 0) return undefined;
    return { ...job, kind: jobKindSchema.parse(job.kind), lease, attempts: job.attempts + 1 };
  }
  async finish(id: string, lease: string, error?: string) {
    await this.db
      .update(badgeJobs)
      .set(
        error === undefined
          ? { state: "done", leaseUntil: 0 }
          : {
              error: error.slice(0, 1500),
              leaseUntil: 0,
              availableAt: Date.now() + 60_000,
              state: "failed",
            },
      )
      .where(and(eq(badgeJobs.id, id), eq(badgeJobs.lease, lease)));
  }
  async retry(reviewId: string, generation: number) {
    await this.db
      .update(badgeJobs)
      .set({ state: "pending", availableAt: Date.now(), leaseUntil: 0 })
      .where(
        and(
          eq(badgeJobs.reviewId, reviewId),
          eq(badgeJobs.generation, generation),
          eq(badgeJobs.state, "failed"),
        ),
      );
  }
  async card(id: string, cardId: string, version: number) {
    // Preserve concurrent workflow changes and never regress a newer delivery receipt.
    await this.db
      .update(badgeReviews)
      .set({
        document: sql`json_set(${badgeReviews.document}, '$.cardId', ${cardId}, '$.cardVersion', ${version})`,
      })
      .where(
        and(
          eq(badgeReviews.id, id),
          sql`${badgeReviews.version} >= ${version}`,
          sql`COALESCE(json_extract(${badgeReviews.document}, '$.cardVersion'), -1) < ${version}`,
        ),
      );
  }
}
export function createBadgeStore(db: Db) {
  return new BadgeRepository(db);
}
export type BadgeStore = ReturnType<typeof createBadgeStore>;
