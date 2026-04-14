import { Redis } from "@upstash/redis";

import type { TaskMeta } from "./types";

function taskKey(id: string) {
  return `task:${id}`;
}

const ALL_KEY = "tasks:all";

function userKey(userId: string) {
  return `tasks:user:${userId}`;
}

let redis: Redis;
function getRedis() {
  return (redis ??= Redis.fromEnv());
}

export async function saveTask(meta: TaskMeta): Promise<void> {
  const r = getRedis();
  await Promise.all([
    r.set(taskKey(meta.id), meta),
    r.sadd(ALL_KEY, meta.id),
    r.sadd(userKey(meta.context.userId), meta.id),
  ]);
}

export async function getTask(id: string): Promise<TaskMeta | null> {
  return getRedis().get<TaskMeta>(taskKey(id));
}

export async function listTasks(opts?: { userId?: string }): Promise<TaskMeta[]> {
  const r = getRedis();
  const ids = opts?.userId
    ? await r.smembers<string[]>(userKey(opts.userId))
    : await r.smembers<string[]>(ALL_KEY);

  if (!ids.length) return [];

  const pipeline = r.pipeline();
  for (const id of ids) pipeline.get(taskKey(id));
  const results = await pipeline.exec<(TaskMeta | null)[]>();

  return results.filter((t): t is TaskMeta => t !== null);
}

export async function removeTask(id: string): Promise<void> {
  const r = getRedis();
  const meta = await getTask(id);
  if (!meta) return;

  await Promise.all([
    r.del(taskKey(id)),
    r.srem(ALL_KEY, id),
    r.srem(userKey(meta.context.userId), id),
  ]);
}
