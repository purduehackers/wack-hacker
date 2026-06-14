import { DuplicateMessageError } from "@vercel/queue";
import { log } from "evlog";

import { defineCron } from "@/bot/crons/define";
import { countMetric } from "@/lib/metrics";
import { captureTraceparent } from "@/lib/otel/tracing";
import { listOverdueActiveTasks } from "@/lib/tasks/db";
import { sendScheduledFire } from "@/lib/tasks/queue/schedule-fire";

/**
 * Rows are only "stale" once their wake-up is comfortably overdue — an hour
 * absorbs queue retry backoff and fire-handler latency without re-enqueuing
 * tasks that are merely slow.
 */
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Reconciliation sweep for dead scheduled-task chains. An active row whose
 * `nextRunAt` is stuck in the past has no in-flight queue message (the fire
 * was acked after exhausting retries, or a checkpoint hop was dropped) and
 * nothing else will ever re-enqueue it. Re-sending the fire lets the handler
 * either run it (never claimed) or finalize-without-action (claimed but
 * unfinalized) — see `healUnfinalizedClaim` in `scheduled-task-fire.ts`.
 */
export const scheduledTaskSweep = defineCron({
  name: "scheduled-task-sweep",
  schedule: "0 6 * * *",
  async handle() {
    const cutoffIso = new Date(Date.now() - STALE_AFTER_MS).toISOString();
    const stale = await listOverdueActiveTasks(cutoffIso);
    if (stale.length === 0) {
      log.info("scheduled-task-sweep", "No stale tasks");
      return;
    }

    // Link every re-enqueued fire back to this sweep run's trace (bounded — one
    // sweep), so a recovered task shows it was resurrected here.
    const traceparent = captureTraceparent();
    let swept = 0;
    let duplicates = 0;
    const failures: Error[] = [];
    for (const task of stale) {
      if (task.nextRunAt === null) continue;
      try {
        await sendScheduledFire(task.id, new Date(task.nextRunAt), 0, traceparent);
        countMetric("scheduled_task.swept", { schedule_type: task.scheduleType });
        swept += 1;
        log.info("scheduled-task-sweep", `Re-enqueued ${task.id} (target ${task.nextRunAt})`);
      } catch (err) {
        // Duplicate idempotency keys (taskId, targetIso) THROW within the
        // queue's dedup window — a wake-up is already in flight (e.g. an
        // hourly task stuck < 24h). Skip the row; never abort the sweep.
        if (err instanceof DuplicateMessageError) {
          duplicates += 1;
          continue;
        }
        failures.push(err as Error);
      }
    }

    log.info(
      "scheduled-task-sweep",
      `Swept ${swept}/${stale.length} stale tasks (${duplicates} already in flight, ${failures.length} failed)`,
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `scheduled-task-sweep: ${failures.length}/${stale.length} re-enqueues failed`,
      );
    }
  },
});
