import { send } from "./client.ts";

import type { TaskEnvelope } from "./types.ts";

import { TASK_TOPIC } from "./constants.ts";

export async function scheduleTask(
  task: string,
  payload: unknown,
  options?: {
    delaySeconds?: number;
    recurring?: { delaySeconds: number; maxRepetitions?: number };
  },
): Promise<string | null> {
  const envelope: TaskEnvelope = {
    task,
    payload,
    recurring: options?.recurring ? { ...options.recurring, repetitionCount: 0 } : undefined,
  };
  const result = await send(TASK_TOPIC, envelope, {
    delaySeconds: options?.delaySeconds ?? 0,
  });
  return result.messageId;
}
