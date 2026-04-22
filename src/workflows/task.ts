import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import { log } from "evlog";
import { sleep, getWorkflowMetadata } from "workflow";

import type { TaskMeta } from "@/lib/tasks/types";

import { AgentContext } from "@/lib/ai/context";
import { MessageRenderer } from "@/lib/ai/message-renderer";
import { streamTurn } from "@/lib/ai/streaming";
import { nextOccurrence } from "@/lib/tasks/cron";
import { saveTask, removeTask, getTask } from "@/lib/tasks/registry";

import type { TaskPayload } from "./types";

export type { TaskPayload } from "./types";

async function persistTask(meta: TaskMeta) {
  "use step";
  await saveTask(meta);
  log.info("task-workflow", `Registered task ${meta.id}: ${meta.description}`);
}

async function computeNextRun(meta: TaskMeta): Promise<Date> {
  "use step";
  if (meta.schedule.type === "once" && meta.schedule.at) {
    return new Date(meta.schedule.at);
  }
  if (meta.schedule.cron) {
    return nextOccurrence(meta.schedule.cron, new Date(), meta.schedule.timezone);
  }
  throw new Error(`Invalid schedule for task ${meta.id}`);
}

async function executeAction(meta: TaskMeta) {
  "use step";
  const discord = new API(new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN!));

  const taskFooter = `-# Task: ${meta.id}`;

  if (meta.action.type === "message") {
    for (const msg of MessageRenderer.splitWithFooter(meta.action.content, taskFooter)) {
      await discord.channels.createMessage(meta.action.channelId, { content: msg });
    }
    log.info("task-workflow", `Sent message for task ${meta.id}`);
  } else if (meta.action.type === "agent") {
    const now = new Date();
    // `memberRoles` is re-resolved by `AgentContext.role` at execute time, so
    // a privilege revocation between scheduling and firing is respected. Do
    // not blank these out — without them the scheduled run loses access to
    // every `delegate_*` subagent.
    const context = AgentContext.fromJSON({
      userId: meta.context.userId,
      username: "system",
      nickname: "Scheduled Task",
      channel: { id: meta.action.channelId, name: "scheduled" },
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
      meta.action.channelId,
      [{ role: "user", content: meta.action.prompt }],
      context.toJSON(),
      { taskId: meta.id },
    );
    log.info("task-workflow", `Ran agent for task ${meta.id}`);
  }
}

async function cleanupTask(id: string) {
  "use step";
  await removeTask(id);
  log.info("task-workflow", `Removed task ${id}`);
}

export async function taskWorkflow(payload: TaskPayload) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const meta: TaskMeta = { ...payload.meta, id: workflowRunId };

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
    if (!current) break;

    await executeAction(meta);
  }
}

async function checkTask(id: string): Promise<TaskMeta | null> {
  "use step";
  return getTask(id);
}
