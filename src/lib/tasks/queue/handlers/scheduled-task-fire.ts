import type { API } from "@discordjs/core/http-only";

import * as Sentry from "@sentry/nextjs";
import { DuplicateMessageError } from "@vercel/queue";
import { z } from "zod";

import type { ScheduledTaskRow } from "@/lib/tasks/types";

import { AgentContext, roleFromMemberRoles } from "@/lib/ai/context.ts";
import { MessageRenderer } from "@/lib/ai/message-renderer.ts";
import { AuditLog, roleAtLeast } from "@/lib/ai/policy";
import { streamTurn } from "@/lib/ai/streaming.ts";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDistribution } from "@/lib/metrics";
import { withSpanFromParent } from "@/lib/otel/tracing";
import { DISCORD_GUILD_ID } from "@/lib/protocol/constants";
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
    traceparent: z.string().optional(),
  }),
  async handle({ taskId, targetIso, traceparent }, discord) {
    return withSpanFromParent(
      traceparent,
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
  // Enrich the request scope so every span/log/issue from this fire is
  // attributable to the owning user and distinguishable from interactive work.
  Sentry.setUser({ id: task.userId });
  Sentry.setTag("source", "scheduled");
  Sentry.setContext("task", {
    id: taskId,
    target_iso: targetIso,
    schedule_type: task.scheduleType,
    action_type: task.action.type,
  });
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
    await healUnfinalizedClaim(taskId, targetIso, logger);
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

/**
 * A failed claim is normally a concurrent duplicate delivery — but it is also
 * the signature of a dead chain: a prior delivery claimed `targetIso`, the
 * action threw, and retries exhausted before reaching `finalizeFire`. Since
 * `finalizeFire` is the only place the next occurrence is enqueued, no
 * in-flight message exists and the row would sit `active` forever. Re-read
 * the row to tell the two apart: if the schedule never advanced past
 * `targetIso`, finalize WITHOUT re-running the action (claim-before-action
 * stays the double-post guard) so recurring chains re-arm; one-time tasks are
 * marked failed — never completed — because the action never verifiably ran.
 */
async function healUnfinalizedClaim(
  taskId: string,
  targetIso: string,
  logger: Logger,
): Promise<void> {
  const row = await getScheduledTask(taskId);
  const advanced =
    !row ||
    row.status !== ScheduledTaskStatus.Active ||
    row.nextRunAt === null ||
    row.nextRunAt > targetIso;
  if (advanced) {
    logger.emit({ outcome: "skip_already_claimed" });
    return;
  }

  countMetric("scheduled_task.claim_healed", { schedule_type: row.scheduleType });

  if (row.scheduleType === ScheduleType.Once) {
    await updateScheduledTask(row.id, {
      status: ScheduledTaskStatus.Failed,
      nextRunAt: null,
      queueMessageId: null,
    });
    logger.emit({ outcome: "once_failed_unfinalized" });
    return;
  }

  logger.set({ heal: { unfinalized_claim: true } });
  // No fire happened here, so there is no new drift to record — passing the
  // stored max keeps finalize's `Math.max` from changing `maxDriftMs`.
  await finalizeFire(row, targetIso, row.maxDriftMs ?? 0, logger);
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
  let messageId: string | null;
  try {
    ({ messageId } = await sendScheduledFire(task.id, next, delaySec));
  } catch (err) {
    // A wake-up for `next` is already in flight — a heal retry after a
    // partial write (send succeeded, row update lost) recomputes the same
    // target while its idempotency key is still inside the dedup window.
    // The goal state already holds, so advance the row instead of failing
    // the delivery and burning its retries.
    if (!(err instanceof DuplicateMessageError)) throw err;
    messageId = null;
    logger.set({ reschedule: { duplicate_in_flight: true } });
  }
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
  // Re-resolve the creator's CURRENT roles instead of trusting the snapshot
  // persisted at schedule time — otherwise a de-roled user keeps organizer-
  // powered recurring runs forever. The snapshot is only a fallback for when
  // Discord is unreachable (an outage must not cancel everyone's tasks).
  // `nowISO` is fresh so `{{NOW_ISO}}` reflects the fire moment.
  const { memberRoles, rolePath } = await resolveFireRoles(discord, task);
  await notifyIfDowngraded(discord, task, memberRoles);

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
    memberRoles,
    source: "scheduled",
  });

  // Group this scheduled agent turn under one conversation in AI Agents
  // Insights, matching what the chat workflow does for interactive turns.
  Sentry.setConversationId(task.id);
  try {
    await streamTurn(discord, channelId, [{ role: "user", content: prompt }], context.toJSON(), {
      taskId: task.id,
      workflowRunId: task.id,
      turnIndex: 1,
    });
  } catch (err: unknown) {
    await recordFireAudit(task, memberRoles, rolePath, "failed");
    throw err;
  }
  await recordFireAudit(task, memberRoles, rolePath, "executed");
}

type RolePath = "resolved" | "member_left" | "snapshot_fallback";

/**
 * Fetch the task creator's current guild roles. A missing member (left or
 * kicked) resolves to no roles — public tier; any other Discord failure
 * degrades to the stored snapshot rather than blocking the fire.
 */
async function resolveFireRoles(
  discord: API,
  task: ScheduledTaskRow,
): Promise<{ memberRoles: string[] | undefined; rolePath: RolePath }> {
  try {
    const member = await discord.guilds.getMember(DISCORD_GUILD_ID, task.userId);
    return { memberRoles: member.roles, rolePath: "resolved" };
  } catch (err: unknown) {
    if (isUnknownMember(err)) {
      return { memberRoles: [], rolePath: "member_left" };
    }
    const message = err instanceof Error ? err.message : "unknown error";
    countMetric("scheduled_task.role_resolution_failed");
    createWideLogger({ op: "scheduled_task.fire", task: { id: task.id } }).emit({
      outcome: "role_resolution_failed",
      reason: message,
    });
    return { memberRoles: task.memberRoles ?? undefined, rolePath: "snapshot_fallback" };
  }
}

/** Discord "Unknown Member" — code 10_007 (raw REST) or a plain 404. */
function isUnknownMember(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, status } = err as { code?: unknown; status?: unknown };
  return code === 10_007 || status === 404;
}

/** Compare the creator's roles now vs the snapshot taken at schedule time. */
function fireRoleChange(task: ScheduledTaskRow, memberRoles: string[] | undefined) {
  const snapshotRole = roleFromMemberRoles(task.memberRoles ?? undefined);
  const currentRole = roleFromMemberRoles(memberRoles);
  return { snapshotRole, currentRole, downgraded: !roleAtLeast(currentRole, snapshotRole) };
}

/**
 * Audit one agent-action fire after it ran (or failed), recording which role
 * resolution path was taken and whether the creator's access had dropped.
 */
async function recordFireAudit(
  task: ScheduledTaskRow,
  memberRoles: string[] | undefined,
  rolePath: RolePath,
  decision: "executed" | "failed",
): Promise<void> {
  const { snapshotRole, currentRole, downgraded } = fireRoleChange(task, memberRoles);

  await new AuditLog().record({
    userId: task.userId,
    role: currentRole,
    source: "scheduled",
    tool: "scheduled_task.fire",
    risk: "write",
    input: { taskId: task.id, description: task.description },
    reason: downgraded
      ? `roles:${rolePath},downgraded:${snapshotRole}->${currentRole}`
      : `roles:${rolePath}`,
    decision,
  });
}

/**
 * Post a channel notice when the creator's access dropped below what it was
 * at schedule time. The run itself proceeds with the (possibly reduced)
 * current role — policy strips whatever the lower tier can no longer reach.
 */
async function notifyIfDowngraded(
  discord: API,
  task: ScheduledTaskRow,
  memberRoles: string[] | undefined,
): Promise<void> {
  const { snapshotRole, currentRole, downgraded } = fireRoleChange(task, memberRoles);
  if (!downgraded) return;
  try {
    await discord.channels.createMessage(task.action.channelId, {
      content:
        `-# ⚠️ Scheduled task **${task.description}** was created by <@${task.userId}> with ` +
        `${snapshotRole} access, but their access is now ${currentRole}. Running with current permissions.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown error";
    createWideLogger({ op: "scheduled_task.fire", task: { id: task.id } }).emit({
      outcome: "downgrade_notice_failed",
      reason: message,
    });
  }
}
