import type { API } from "@discordjs/core/http-only";
import type { z } from "zod";

export interface TaskHandler<T = unknown> {
  name: string;
  schema: z.ZodType<T>;
  handle(payload: T, discord: API): Promise<void>;
}

export interface TaskEnvelope {
  task: string;
  payload: unknown;
  recurring?: {
    delaySeconds: number;
    maxRepetitions?: number;
    repetitionCount?: number;
  };
}
