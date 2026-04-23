import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { sleep, getWorkflowMetadata } from "workflow";

import type { TaskMeta } from "@/lib/tasks/types";

import { AgentContext } from "@/lib/ai/context";
import { MessageRenderer } from "@/lib/ai/message-renderer";
import { streamTurn } from "@/lib/ai/streaming";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { withSpan } from "@/lib/otel/tracing";
import { nextOccurrence } from "@/lib/tasks/cron";
import { saveTask, removeTask, getTask } from "@/lib/tasks/registry";

import type { TaskPayload } from "./types";

export type { TaskPayload } from "./types";

async function persistTask(meta: TaskMeta) {
  "use step";
  return withSpan(
    "workflow.task.persist",
    { "task.id": meta.id, "task.schedule_type": meta.schedule.type },
    async () => {
      const logger = createWideLogger({
        op: "workflow.task.persist",
        task: {
          id: meta.id,
          description: meta.description,
          schedule_type: meta.schedule.type,
          action_type: meta.action.type,
        },
      });
      try {
        await saveTask(meta);
        countMetric("workflow.task.persisted", { schedule_type: meta.schedule.type });
        logger.emit({ outcome: "ok" });
      } catch (err) {
        logger.error(err as Error);
        logger.emit({ outcome: "error" });
        throw err;
      }
    },
  );
}

async function computeNextRun(meta: TaskMeta): Promise<Date> {
  "use step";
  return withSpan(
    "workflow.task.compute_next_run",
    { "task.id": meta.id, "task.schedule_type": meta.schedule.type },
    async () => {
      const logger = createWideLogger({
        op: "workflow.task.compute_next_run",
        task: { id: meta.id, schedule_type: meta.schedule.type },
      });
      try {
        let next: Date;
        if (meta.schedule.type === "once" && meta.schedule.at) {
          next = new Date(meta.schedule.at);
        } else if (meta.schedule.cron) {
          next = nextOccurrence(meta.schedule.cron, new Date(), meta.schedule.timezone);
        } else {
          throw new Error(`Invalid schedule for task ${meta.id}`);
        }
        logger.emit({ outcome: "ok", next_run_at: next.toISOString() });
        return next;
      } catch (err) {
        logger.error(err as Error);
        logger.emit({ outcome: "error" });
        throw err;
      }
    },
  );
}

async function executeAction(meta: TaskMeta) {
  "use step";
  return withSpan(
    "workflow.task.execute_action",
    { "task.id": meta.id, "task.action_type": meta.action.type },
    async () => {
      const logger = createWideLogger({
        op: "workflow.task.execute_action",
        task: { id: meta.id, action_type: meta.action.type },
      });
      const startTime = Date.now();
      try {
        const discord = new API(
          new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN!),
        );

        const taskFooter = `-# Task: ${meta.id}`;

        if (meta.action.type === "message") {
          const channelId = meta.action.channelId;
          logger.set({ task: { channel_id: channelId } });
          let messages = 0;
          for (const msg of MessageRenderer.splitWithFooter(meta.action.content, taskFooter)) {
            await discord.channels.createMessage(channelId, { content: msg });
            messages += 1;
          }
          logger.set({ task: { messages_sent: messages } });
        } else if (meta.action.type === "agent") {
          const channelId = meta.action.channelId;
          logger.set({ task: { channel_id: channelId } });
          const now = new Date();
          // `memberRoles` is re-resolved by `AgentContext.role` at execute time, so
          // a privilege revocation between scheduling and firing is respected. Do
          // not blank these out — without them the scheduled run loses access to
          // every `delegate_*` subagent.
          const context = AgentContext.fromJSON({
            userId: meta.context.userId,
            username: "system",
            nickname: "Scheduled Task",
            channel: { id: channelId, name: "scheduled" },
            date: now.toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
            memberRoles: meta.context.memberRoles,
          });
          await streamTurn(
            discord,
            channelId,
            [{ role: "user", content: meta.action.prompt }],
            context.toJSON(),
            { taskId: meta.id, workflowRunId: meta.id, turnIndex: 1 },
          );
        }
        countMetric("workflow.task.action_completed", { action_type: meta.action.type });
        logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
      } catch (err) {
        countMetric("workflow.task.action_error", { action_type: meta.action.type });
        logger.error(err as Error);
        logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
        throw err;
      } finally {
        recordDuration("workflow.task.action_duration", Date.now() - startTime, {
          action_type: meta.action.type,
        });
      }
    },
  );
}

async function cleanupTask(id: string) {
  "use step";
  return withSpan("workflow.task.cleanup", { "task.id": id }, async () => {
    const logger = createWideLogger({ op: "workflow.task.cleanup", task: { id } });
    try {
      await removeTask(id);
      countMetric("workflow.task.cleanup_completed");
      logger.emit({ outcome: "ok" });
    } catch (err) {
      logger.error(err as Error);
      logger.emit({ outcome: "error" });
      throw err;
    }
  });
}

export async function taskWorkflow(payload: TaskPayload) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const meta: TaskMeta = { ...payload.meta, id: workflowRunId };

  countMetric("workflow.task.started", {
    schedule_type: meta.schedule.type,
    action_type: meta.action.type,
  });

  await persistTask(meta);

  if (meta.schedule.type === "once") {
    const target = await computeNextRun(meta);
    await sleep(target);
    await executeAction(meta);
    await cleanupTask(meta.id);
    return;
  }

  // Recurring: loop until cancelled
  while (true) {
    const target = await computeNextRun(meta);
    await sleep(target);

    // Check if task was removed (cancelled) while sleeping
    const current = await checkTask(meta.id);
    if (!current) {
      countMetric("workflow.task.cancelled_during_sleep");
      break;
    }

    await executeAction(meta);
  }
}

async function checkTask(id: string): Promise<TaskMeta | null> {
  "use step";
  return withSpan("workflow.task.check", { "task.id": id }, () => getTask(id));
}
