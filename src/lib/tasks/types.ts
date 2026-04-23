import type { ScheduledTaskStatus, ScheduleType } from "./enums.ts";

export type TaskAction =
  | { type: "message"; channelId: string; content: string }
  | { type: "agent"; channelId: string; prompt: string };

export interface ScheduledTaskRow {
  id: string;
  userId: string;
  channelId: string;
  description: string;
  scheduleType: ScheduleType;
  runAt: string | null;
  cron: string | null;
  timezone: string | null;
  action: TaskAction;
  memberRoles: string[] | null;
  status: ScheduledTaskStatus;
  nextRunAt: string | null;
  queueMessageId: string | null;
  lastFiredAt: string | null;
  fireCount: number;
  maxDriftMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export type NewScheduledTask = Pick<
  ScheduledTaskRow,
  | "id"
  | "userId"
  | "channelId"
  | "description"
  | "scheduleType"
  | "runAt"
  | "cron"
  | "timezone"
  | "action"
  | "memberRoles"
  | "status"
  | "nextRunAt"
  | "queueMessageId"
>;

export type ScheduledTaskPatch = Partial<
  Pick<
    ScheduledTaskRow,
    "status" | "nextRunAt" | "queueMessageId" | "lastFiredAt" | "fireCount" | "maxDriftMs"
  >
>;

export interface ScheduledTaskFirePayload {
  taskId: string;
  /** Original ISO target; unchanged across checkpoint hops. */
  targetIso: string;
}
