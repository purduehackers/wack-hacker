import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { TaskAction } from "@/lib/tasks/types";

import { ScheduledTaskStatus, ScheduleType } from "@/lib/tasks/enums";

export const scheduledTasks = sqliteTable(
  "scheduled_tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    channelId: text("channel_id").notNull(),
    description: text("description").notNull(),
    scheduleType: text("schedule_type").$type<ScheduleType>().notNull(),
    runAt: text("run_at"),
    cron: text("cron"),
    timezone: text("timezone"),
    action: text("action", { mode: "json" }).$type<TaskAction>().notNull(),
    memberRoles: text("member_roles", { mode: "json" }).$type<string[]>(),
    status: text("status")
      .$type<ScheduledTaskStatus>()
      .notNull()
      .default(ScheduledTaskStatus.Active),
    nextRunAt: text("next_run_at"),
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
