import type { TaskHandler } from "./types.ts";

export function defineTask<T>(task: TaskHandler<T>): TaskHandler<T> {
  return task;
}
