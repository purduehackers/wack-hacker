import type { ScheduledTaskFirePayload } from "../types.ts";
import type { TaskEnvelope } from "./types.ts";

import { send } from "./client.ts";
import { SCHEDULED_TASK_FIRE_TASK, TASK_TOPIC } from "./constants.ts";

// Vercel Queue caps `delaySeconds` and `retentionSeconds` at 7 days. For
// horizons past that we enqueue a "checkpoint" at 6 days — the fire handler
// re-reads the real target from the payload and re-enqueues the remainder.
// Leaving 1d of slack below `retentionSeconds` ensures the checkpoint message
// never expires in-flight.
const MAX_RETENTION_SECONDS = 604_800; // 7 days
const CHECKPOINT_SECONDS = 518_400; // 6 days

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Enqueue a wake-up for a scheduled task. Idempotent on `(taskId, targetIso)`
 * within the queue's 24h dedup window — duplicate sends from tool retries or
 * race conditions collapse into a single delivered message.
 */
export async function sendScheduledFire(
  taskId: string,
  target: Date,
  delaySec: number,
): Promise<{ messageId: string | null }> {
  const targetIso = target.toISOString();
  const envelope: TaskEnvelope = {
    task: SCHEDULED_TASK_FIRE_TASK,
    payload: { taskId, targetIso } satisfies ScheduledTaskFirePayload,
  };
  return send<TaskEnvelope>(TASK_TOPIC, envelope, {
    delaySeconds: clamp(Math.floor(delaySec), 0, CHECKPOINT_SECONDS),
    retentionSeconds: MAX_RETENTION_SECONDS,
    idempotencyKey: `${taskId}:${targetIso}`,
  });
}
