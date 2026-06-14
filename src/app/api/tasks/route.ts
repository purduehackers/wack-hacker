import type { API } from "@discordjs/core/http-only";

import type { TaskEnvelope, TaskHandler } from "@/lib/tasks/queue/types";

import { ConversationStore } from "@/bot/store";
import { createDiscordAPI } from "@/lib/discord/client";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { withSpanFromParent } from "@/lib/otel/tracing";
import { handleCallback } from "@/lib/tasks/queue/client";
import { InvalidTaskPayloadError, UnknownTaskError } from "@/lib/tasks/queue/errors";
import * as taskHandlers from "@/lib/tasks/queue/handlers";

const taskMap = new Map((Object.values(taskHandlers) as TaskHandler[]).map((h) => [h.name, h]));

const MAX_RETRIES = 3;

type Logger = ReturnType<typeof createWideLogger>;

async function runHandler(
  envelope: TaskEnvelope,
  discord: API,
  logger: Logger,
  startTime: number,
): Promise<void> {
  const handler = taskMap.get(envelope.task);
  if (!handler) {
    countMetric("task.unknown", { name: envelope.task });
    const err = new UnknownTaskError(envelope.task);
    logger.error(err);
    logger.emit({ outcome: "unknown_task", duration_ms: Date.now() - startTime });
    throw err;
  }

  const parsed = handler.schema.safeParse(envelope.payload);
  if (!parsed.success) {
    countMetric("task.invalid_payload", { name: envelope.task });
    const err = new InvalidTaskPayloadError(envelope.task, parsed.error);
    logger.error(err);
    logger.emit({ outcome: "invalid_payload", duration_ms: Date.now() - startTime });
    throw err;
  }

  await handler.handle(parsed.data, discord);
}

export const POST = handleCallback<TaskEnvelope>(
  async (envelope, metadata) => {
    // Join the origin trace when the payload carries a traceparent (scheduled
    // fires do), so the dispatcher span shares the creating turn's trace instead
    // of being orphaned in its own. Falls back to a root span otherwise.
    const traceparent = (envelope.payload as { traceparent?: string } | undefined)?.traceparent;
    return withSpanFromParent(
      traceparent,
      "task.callback",
      {
        "task.name": envelope.task,
        "task.delivery_count": metadata.deliveryCount,
        "queue.message_id": metadata.messageId,
      },
      async () => {
        const logger = createWideLogger({
          op: "task.callback",
          task: { name: envelope.task },
          queue: { message_id: metadata.messageId, delivery_count: metadata.deliveryCount },
        });
        const startTime = Date.now();
        countMetric("task.received", { name: envelope.task });
        const store = new ConversationStore();
        const dedupKey = `task:${metadata.messageId}`;
        let dedupClaimed = false;
        try {
          if (!(await store.dedup(dedupKey))) {
            countMetric("task.dedup_hit", { name: envelope.task });
            logger.emit({ outcome: "dedup_hit", duration_ms: Date.now() - startTime });
            return;
          }
          dedupClaimed = true;

          await runHandler(envelope, createDiscordAPI(), logger, startTime);

          countMetric("task.completed", { name: envelope.task });
          logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
        } catch (err) {
          countMetric("task.error", { name: envelope.task });
          if (!(err instanceof UnknownTaskError) && !(err instanceof InvalidTaskPayloadError)) {
            logger.error(err as Error);
            logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
          }
          // Release the dedup claim so the queue's retry can actually re-run
          // the handler. Without this, a transient failure (Discord 5xx, DB
          // blip) becomes a permanent lost run — the claim sits until its
          // 5-min TTL while every retry short-circuits as "dedup_hit".
          // Handlers that must not re-execute on retry own that invariant at
          // their own layer (e.g. `scheduled-task-fire` claims in Turso via
          // `claimFire` before any side effect).
          if (dedupClaimed) {
            await store.releaseDedup(dedupKey).catch(() => {});
          }
          throw err;
        } finally {
          recordDuration("task.duration", Date.now() - startTime, { name: envelope.task });
        }
      },
    );
  },
  {
    // Matches `maxDuration: 600` configured for this function in vercel.ts so
    // an agent-action fire (which can stream for several minutes) doesn't get
    // redelivered by the queue while still in-flight.
    visibilityTimeoutSeconds: 600,
    retry: (_error, metadata) => {
      if (metadata.deliveryCount >= MAX_RETRIES) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 5) };
    },
  },
);
