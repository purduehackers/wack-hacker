import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { ScheduleActionType, ScheduleType, ScheduledTaskStatus } from "../column-enums.ts";

/** Durable prompts claimed by the once-a-minute Eve dispatcher. */
export const scheduledTasks = sqliteTable(
  "scheduled_tasks",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    channelId: text("channel_id").notNull(),
    description: text("description").notNull(),
    actionType: text("action_type")
      .$type<ScheduleActionType>()
      .notNull()
      .default(ScheduleActionType.Agent),
    prompt: text("prompt").notNull(),
    /** Creation-time snapshot used only when Discord role lookup is unavailable. */
    memberRoles: text("member_roles", { mode: "json" }).$type<string[]>(),
    scheduleType: text("schedule_type").$type<ScheduleType>().notNull(),
    cron: text("cron"),
    timezone: text("timezone"),
    status: text("status")
      .$type<ScheduledTaskStatus>()
      .notNull()
      .default(ScheduledTaskStatus.Active),
    /** The stable occurrence anchor. Retries never advance it. */
    nextRunAt: text("next_run_at").notNull(),
    /** Retry eligibility, independently movable from `nextRunAt`. */
    availableAt: text("available_at").notNull(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: text("lease_expires_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    lastDispatchedAt: text("last_dispatched_at"),
    fireCount: integer("fire_count").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    check("scheduled_tasks_action_type_check", sql`${table.actionType} IN ('agent', 'message')`),
    check(
      "scheduled_tasks_shape_check",
      sql`(${table.scheduleType} = 'once' AND ${table.cron} IS NULL AND ${table.timezone} IS NULL) OR (${table.scheduleType} = 'recurring' AND ${table.cron} IS NOT NULL AND ${table.timezone} IS NOT NULL)`,
    ),
    check("scheduled_tasks_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check("scheduled_tasks_fire_count_check", sql`${table.fireCount} >= 0`),
    index("scheduled_tasks_due_idx").on(table.status, table.availableAt, table.leaseExpiresAt),
    index("scheduled_tasks_owner_idx").on(table.ownerId, table.status, table.createdAt),
  ],
);
