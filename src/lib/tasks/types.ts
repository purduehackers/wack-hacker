export interface TaskMeta {
  /** Workflow run ID — doubles as the unique task identifier. */
  id: string;
  /** Human-readable summary shown in list_tasks output. */
  description: string;
  action: TaskAction;
  schedule: TaskSchedule;
  context: TaskContext;
  createdAt: string;
}

export type TaskAction =
  | { type: "message"; channelId: string; content: string }
  | { type: "agent"; channelId: string; prompt: string };

export interface TaskSchedule {
  type: "once" | "recurring";
  /** ISO 8601 datetime — used for one-time tasks. */
  at?: string;
  /** 5-field cron expression — used for recurring tasks. */
  cron?: string;
  /** IANA timezone. Defaults to America/Indiana/Indianapolis. */
  timezone?: string;
}

export interface TaskContext {
  userId: string;
  channelId: string;
}
