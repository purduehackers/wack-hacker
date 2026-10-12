import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const badgeReviews = sqliteTable(
  "badge_reviews",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    version: integer("version").notNull(),
    document: text("document").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("badge_reviews_thread").on(table.threadId)],
);

export const badgeAssets = sqliteTable("badge_assets", {
  hash: text("hash").primaryKey(),
  mediaType: text("media_type").notNull(),
  data: text("data").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const badgeEvents = sqliteTable(
  "badge_events",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id").notNull(),
    actorId: text("actor_id").notNull(),
    document: text("document").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("badge_events_review").on(table.reviewId, table.createdAt)],
);

export const badgeInbox = sqliteTable("badge_inbox", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  document: text("document").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const badgeJobs = sqliteTable(
  "badge_jobs",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id").notNull(),
    generation: integer("generation").notNull(),
    kind: text("kind").notNull(),
    state: text("state").notNull().default("pending"),
    availableAt: integer("available_at").notNull(),
    lease: text("lease"),
    leaseUntil: integer("lease_until").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
  },
  (table) => [index("badge_jobs_due").on(table.state, table.availableAt, table.leaseUntil)],
);
