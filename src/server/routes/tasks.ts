import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { handleCallback, send } from "@vercel/queue";
import { log } from "evlog";
import { Hono } from "hono";

import type { TaskHandler, TaskEnvelope } from "@/lib/ai/tasks/types";

import { env } from "@/env";
import * as tasks from "@/lib/ai/tasks";
import { TASK_TOPIC } from "@/lib/ai/tasks/constants";
import { UnknownTaskError, InvalidTaskPayloadError } from "@/lib/ai/tasks/errors";
import { ConversationStore } from "@/lib/bot/store";

const taskMap = new Map((Object.values(tasks) as TaskHandler[]).map((t) => [t.name, t]));

const MAX_RETRIES = 3;

const consumer = handleCallback<TaskEnvelope>(
  async (envelope, metadata) => {
    const store = new ConversationStore();

    if (!(await store.dedup(`task:${metadata.messageId}`))) {
      log.info("tasks", `Dedup hit for ${envelope.task}, skipping`);
      return;
    }

    const handler = taskMap.get(envelope.task);
    if (!handler) {
      throw new UnknownTaskError(envelope.task);
    }

    const parsed = handler.schema.safeParse(envelope.payload);
    if (!parsed.success) {
      throw new InvalidTaskPayloadError(envelope.task, parsed.error);
    }

    log.info("tasks", `Running ${envelope.task} (attempt ${metadata.deliveryCount})`);

    const discord = new API(new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN));
    await handler.handle(parsed.data, discord);

    if (envelope.recurring) {
      const { delaySeconds, maxRepetitions, repetitionCount = 0 } = envelope.recurring;
      const next = repetitionCount + 1;

      if (maxRepetitions === undefined || next < maxRepetitions) {
        await send(
          TASK_TOPIC,
          {
            ...envelope,
            recurring: { ...envelope.recurring, repetitionCount: next },
          },
          { delaySeconds },
        );
        log.info(
          "tasks",
          `Re-enqueued ${envelope.task} (${next}/${maxRepetitions ?? "∞"}) in ${delaySeconds}s`,
        );
      } else {
        log.info("tasks", `${envelope.task} completed all ${maxRepetitions} repetitions`);
      }
    }
  },
  {
    retry: (_error, metadata) => {
      if (metadata.deliveryCount >= MAX_RETRIES) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 5) };
    },
  },
);

const route = new Hono();

route.post("/tasks", (c) => consumer(c.req.raw));

export default route;
