import type { API } from "@discordjs/core/http-only";

import { z } from "zod";

import type { ScheduledTaskRow } from "@/lib/tasks/types";

import { AgentContext } from "@/lib/ai/context.ts";
import { MessageRenderer } from "@/lib/ai/message-renderer.ts";
import { streamTurn } from "@/lib/ai/streaming.ts";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDistribution } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";
import { DEFAULT_TIMEZONE } from "@/lib/tasks/constants";
import { nextOccurrence } from "@/lib/tasks/cron";
import { claimFire, getScheduledTask, updateScheduledTask } from "@/lib/tasks/db";
import { ScheduledTaskStatus, ScheduleType } from "@/lib/tasks/enums";

import { SCHEDULED_TASK_FIRE_TASK } from "../constants.ts";
import { defineTask } from "../define.ts";
import { sendScheduledFire } from "../schedule-fire.ts";

/** Tolerance for pre-target delivery. Sub-second jitter still counts as "now". */
const CHECKPOINT_GUARD_MS = 5_000;

type Logger = ReturnType<typeof createWideLogger>;

export const scheduledTaskFire = defineTask({
  name: SCHEDULED_TASK_FIRE_TASK,
  schema: z.object({
    taskId: z.string(),
    targetIso: z.string(),
  }),
  async handle({ taskId, targetIso }, discord) {
    return withSpan(
      "scheduled_task.fire",
      { "task.id": taskId, "task.target_iso": targetIso },
      () => runFire({ taskId, targetIso }, discord),
    );
  },
});

async function runFire(
  payload: { taskId: string; targetIso: string },
  discord: API,
): Promise<void> {
  const { taskId, targetIso } = payload;
  const logger = createWideLogger({
    op: "scheduled_task.fire",
    task: { id: taskId, target_iso: targetIso },
  });

  const task = await getScheduledTask(taskId);
  if (!task) {
    logger.emit({ outcome: "skip_missing_row" });
    return;
  }
  if (isSkippable(task, targetIso, logger)) return;

  const targetMs = new Date(targetIso).getTime();

  // Checkpoint hop: horizons > 6d enqueue at 6d out; on delivery we
  // re-enqueue the remaining delay. Idempotent on (taskId, targetIso).
  if (Date.now() < targetMs - CHECKPOINT_GUARD_MS) {
    await rehydrateCheckpoint(taskId, targetMs, task.scheduleType, logger);
    return;
  }

  // Atomic claim before any side effect. Prevents double-firing when the
  // queue retries a message whose prior attempt posted to Discord but
  // failed to finalize the row — the retry sees `lastFiredAt == targetIso`
  // and short-circuits here instead of running the action again.
  const claimed = await claimFire(taskId, targetIso);
  if (!claimed) {
    logger.emit({ outcome: "skip_already_claimed" });
    return;
  }

  const drift = Date.now() - targetMs;
  recordDistribution("scheduled_task.fire_drift_ms", drift, {
    schedule_type: task.scheduleType,
    action_type: task.action.type,
  });

  try {
    await executeAction(task, discord);
  } catch (err) {
    countMetric("scheduled_task.action_error", {
      schedule_type: task.scheduleType,
      action_type: task.action.type,
    });
    logger.error(err as Error);
    logger.emit({ outcome: "action_error", drift_ms: drift });
    throw err;
  }

  await finalizeFire(task, targetIso, drift, logger);
}

function isSkippable(task: ScheduledTaskRow, targetIso: string, logger: Logger): boolean {
  if (task.status !== ScheduledTaskStatus.Active) {
    logger.emit({ outcome: "skip_inactive", task: { status: task.status } });
    return true;
  }
  // ISO 8601 strings are lexicographically ordered. A `nextRunAt` that is
  // *ahead of* the delivered `targetIso` means a newer re-enqueue already
  // advanced the row — drop this wake-up. A `nextRunAt` that is equal or
  // *behind* `targetIso` still fires: equal is the normal path, and behind
  // catches the "finalizeFire advanced the queue but the row update was
  // lost" partial-write case so the recurring chain self-heals.
  if (task.nextRunAt !== null && task.nextRunAt > targetIso) {
    logger.emit({ outcome: "skip_superseded", task: { next_run_at: task.nextRunAt } });
    return true;
  }
  return false;
}

async function rehydrateCheckpoint(
  taskId: string,
  targetMs: number,
  scheduleType: ScheduleType,
  logger: Logger,
): Promise<void> {
  const remainingSec = Math.floor((targetMs - Date.now()) / 1000);
  const { messageId } = await sendScheduledFire(taskId, new Date(targetMs), remainingSec);
  await updateScheduledTask(taskId, { queueMessageId: messageId });
  countMetric("scheduled_task.checkpoint_hop", { schedule_type: scheduleType });
  logger.emit({ outcome: "checkpoint_hop", task: { remaining_sec: remainingSec } });
}

async function finalizeFire(
  task: ScheduledTaskRow,
  targetIso: string,
  drift: number,
  logger: Logger,
): Promise<void> {
  // `fireCount` + `lastFiredAt` were already bumped by `claimFire`; finalize
  // only writes fields that depend on action outcome or schedule advancement.
  const maxDriftMs = Math.max(task.maxDriftMs ?? 0, drift);

  if (task.scheduleType === ScheduleType.Once) {
    await updateScheduledTask(task.id, {
      status: ScheduledTaskStatus.Completed,
      nextRunAt: null,
      queueMessageId: null,
      maxDriftMs,
    });
    countMetric("scheduled_task.completed", { schedule_type: ScheduleType.Once });
    logger.emit({ outcome: "ok_once", drift_ms: drift });
    return;
  }

  // Recurring: anchor next occurrence to the scheduled target so a slow
  // action run doesn't push the next iteration. If the fire was late enough
  // that the anchored "next" is already in the past, recompute from `now`
  // instead — otherwise a minutely task that fires 10 min late would dump
  // 10 back-to-back backfills into the channel.
  const targetMs = new Date(targetIso).getTime();
  const tz = task.timezone ?? undefined;
  let next: Date;
  try {
    next = nextOccurrence(task.cron!, new Date(targetMs), tz);
    if (next.getTime() <= Date.now()) {
      const skipped = next;
      next = nextOccurrence(task.cron!, new Date(), tz);
      countMetric("scheduled_task.recurring_intervals_skipped");
      logger.set({
        recurring: {
          first_skipped_run_at: skipped.toISOString(),
          resumed_at: next.toISOString(),
        },
      });
    }
  } catch (err) {
    await updateScheduledTask(task.id, {
      status: ScheduledTaskStatus.Failed,
      nextRunAt: null,
      queueMessageId: null,
      maxDriftMs,
    });
    countMetric("scheduled_task.recurring_parse_error");
    logger.error(err as Error);
    logger.emit({ outcome: "recurring_parse_error" });
    throw err;
  }

  const delaySec = Math.max(0, Math.floor((next.getTime() - Date.now()) / 1000));
  const { messageId } = await sendScheduledFire(task.id, next, delaySec);
  await updateScheduledTask(task.id, {
    nextRunAt: next.toISOString(),
    queueMessageId: messageId,
    maxDriftMs,
  });
  countMetric("scheduled_task.recurring_rescheduled");
  logger.emit({
    outcome: "ok_recurring",
    drift_ms: drift,
    next_run_at: next.toISOString(),
  });
}

async function executeAction(task: ScheduledTaskRow, discord: API): Promise<void> {
  const taskFooter = `-# Task: ${task.id}`;

  if (task.action.type === "message") {
    const { channelId, content } = task.action;
    for (const chunk of MessageRenderer.splitWithFooter(content, taskFooter)) {
      await discord.channels.createMessage(channelId, { content: chunk });
    }
    return;
  }

  const { channelId, prompt } = task.action;
  const fireTime = new Date();
  // `memberRoles` is re-resolved by `AgentContext.role` at execute time, so a
  // privilege revocation between scheduling and firing is honored. `nowISO`
  // is fresh so `{{NOW_ISO}}` reflects the fire moment, not schedule time.
  const context = AgentContext.fromJSON({
    userId: task.userId,
    username: "system",
    nickname: "Scheduled Task",
    channel: { id: channelId, name: "scheduled" },
    date: fireTime.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    nowISO: fireTime.toISOString(),
    timezone: task.timezone ?? DEFAULT_TIMEZONE,
    memberRoles: task.memberRoles ?? undefined,
  });

  await streamTurn(discord, channelId, [{ role: "user", content: prompt }], context.toJSON(), {
    taskId: task.id,
    workflowRunId: task.id,
    turnIndex: 1,
  });
}
