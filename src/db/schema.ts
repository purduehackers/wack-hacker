import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    discord_username: text("discord_username").notNull(),
    thread_id: text("thread_id"),
    created_at: text("created_at").default(sql`(datetime('now'))`),
    updated_at: text("updated_at").default(sql`(datetime('now'))`),
});

export const commits = sqliteTable("commits", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: text("user_id").notNull(),
    message_id: text("message_id").notNull(),
    commit_day: text("commit_day").notNull(),
    approved_at: text("approved_at"),
    approved_by: text("approved_by"),
    created_at: text("created_at").default(sql`(datetime('now'))`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Commit = typeof commits.$inferSelect;
export type NewCommit = typeof commits.$inferInsert;
