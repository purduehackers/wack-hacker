import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { ScheduleType, ScheduledTaskStatus } from "../enums.ts";
import type { TaskAction } from "../types.ts";

/**
 * The authoritative record for every agent-created scheduled task.
 *
 * The legacy app paired this table with a Vercel Queue: a row plus a delayed
 * message, reconciled by a claim/heal protocol and a nightly sweep. The queue is
 * gone — a once-a-minute eve schedule claims due rows directly — but the table
 * is unchanged, so existing schedules survive the migration.
 *
 * `memberRoles` is a snapshot taken when the task was created. It is a
 * *fallback only*: a fire re-resolves the creator's current Discord roles so a
 * de-roled organizer stops getting organizer-powered runs. The snapshot is used
 * solely when Discord itself is unreachable.
 *
 * `(status, next_run_at)` is the index the dispatcher's claim query rides.
 */
export const scheduledTasks = sqliteTable(
  "scheduled_tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    channelId: text("channel_id").notNull(),
    description: text("description").notNull(),
    scheduleType: text("schedule_type").$type<ScheduleType>().notNull(),
    /** Set for one-time tasks. ISO 8601; sorts lexicographically. */
    runAt: text("run_at"),
    /** Set for recurring tasks. Five-field cron, evaluated in `timezone`. */
    cron: text("cron"),
    timezone: text("timezone"),
    action: text("action", { mode: "json" }).$type<TaskAction>().notNull(),
    memberRoles: text("member_roles", { mode: "json" }).$type<string[]>(),
    status: text("status")
      .$type<ScheduledTaskStatus>()
      .notNull()
      .default(ScheduledTaskStatus.Active),
    nextRunAt: text("next_run_at"),
    /**
     * Retained from the queue-based design so in-flight rows written by the old
     * system still round-trip. The dispatcher does not write it.
     */
    queueMessageId: text("queue_message_id"),
    lastFiredAt: text("last_fired_at"),
    fireCount: integer("fire_count").notNull().default(0),
    maxDriftMs: integer("max_drift_ms"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("scheduled_tasks_user_status_idx").on(table.userId, table.status),
    index("scheduled_tasks_status_next_run_idx").on(table.status, table.nextRunAt),
  ],
);
