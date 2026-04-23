import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";

import type { NewScheduledTask, ScheduledTaskPatch, ScheduledTaskRow } from "./types.ts";

import { getDb } from "../db/index.ts";
import { scheduledTasks } from "../db/schemas/scheduled-tasks.ts";
import { ScheduledTaskStatus } from "./enums.ts";

export async function saveScheduledTask(row: NewScheduledTask): Promise<void> {
  await getDb().insert(scheduledTasks).values(row);
}

export async function getScheduledTask(id: string): Promise<ScheduledTaskRow | null> {
  const [record] = await getDb().select().from(scheduledTasks).where(eq(scheduledTasks.id, id));
  return (record as ScheduledTaskRow | undefined) ?? null;
}

export async function updateScheduledTask(id: string, patch: ScheduledTaskPatch): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await getDb()
    .update(scheduledTasks)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(scheduledTasks.id, id));
}

/**
 * Atomically claim the fire slot for `(id, targetIso)`. Returns `true` when
 * this invocation won the race and should proceed with the action; `false`
 * when a concurrent delivery (or a queue retry past the route's dedup window)
 * already recorded the fire. Gated on `status='active'` and `lastFiredAt`
 * being either unset or lexicographically older than `targetIso`, so the
 * claim is idempotent for same-target retries even if the dedup marker has
 * expired.
 */
export async function claimFire(id: string, targetIso: string): Promise<boolean> {
  const rows = await getDb()
    .update(scheduledTasks)
    .set({
      lastFiredAt: targetIso,
      fireCount: sql`${scheduledTasks.fireCount} + 1`,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(scheduledTasks.id, id),
        eq(scheduledTasks.status, ScheduledTaskStatus.Active),
        or(isNull(scheduledTasks.lastFiredAt), lt(scheduledTasks.lastFiredAt, targetIso)),
      ),
    )
    .returning({ id: scheduledTasks.id });
  return rows.length > 0;
}

export async function listScheduledTasks(opts?: { userId?: string }): Promise<ScheduledTaskRow[]> {
  const where = opts?.userId
    ? and(
        eq(scheduledTasks.userId, opts.userId),
        eq(scheduledTasks.status, ScheduledTaskStatus.Active),
      )
    : eq(scheduledTasks.status, ScheduledTaskStatus.Active);
  const rows = await getDb()
    .select()
    .from(scheduledTasks)
    .where(where)
    .orderBy(desc(scheduledTasks.createdAt));
  return rows as ScheduledTaskRow[];
}
