import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    discord_username: text("discord_username").notNull(),
    created_at: text("created_at").default(sql`(datetime('now'))`),
    updated_at: text("updated_at").default(sql`(datetime('now'))`),
});

export const commitOverflowProfiles = sqliteTable("commit_overflow_profiles", {
    user_id: text("user_id").primaryKey(),
    thread_id: text("thread_id").notNull(),
    timezone: text("timezone").notNull().default("America/Indiana/Indianapolis"),
    is_private: integer("is_private", { mode: "boolean" }).notNull().default(false),
    created_at: text("created_at").default(sql`(datetime('now'))`),
});

export const commits = sqliteTable("commits", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: text("user_id").notNull(),
    message_id: text("message_id").notNull(),
    committed_at: text("committed_at").notNull(),
    approved_at: text("approved_at"),
    approved_by: text("approved_by"),
    is_private: integer("is_private", { mode: "boolean" }).notNull().default(false),
    is_explicitly_private: integer("is_explicitly_private", { mode: "boolean" })
        .notNull()
        .default(false),
    created_at: text("created_at").default(sql`(datetime('now'))`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type CommitOverflowProfile = typeof commitOverflowProfiles.$inferSelect;
export type NewCommitOverflowProfile = typeof commitOverflowProfiles.$inferInsert;
export type Commit = typeof commits.$inferSelect;
export type NewCommit = typeof commits.$inferInsert;
