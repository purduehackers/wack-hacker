import { tool } from "ai";
import { start, getRun } from "workflow/api";
import { z } from "zod";

import type { TaskAction, TaskSchedule } from "../../../tasks/types.ts";
import type { AgentContext } from "../../context.ts";

import { taskWorkflow } from "../../../../workflows/task.ts";
import { nextOccurrence } from "../../../tasks/cron.ts";
import { listTasks as listTasksFromRegistry, removeTask } from "../../../tasks/registry.ts";

/**
 * Build the schedule tool bound to the scheduler's `AgentContext`. The closure
 * captures `context.memberRoles` so the persisted `TaskMeta` carries the
 * scheduler's Discord role IDs — without that, scheduled agent runs resolve to
 * `UserRole.Public` and lose access to every `delegate_*` subagent.
 */
export function createScheduleTask(context: AgentContext) {
  return tool({
    description:
      "Schedule a one-time or recurring task. Use action_type 'message' for static text (reminders, announcements) or 'agent' to run an AI prompt at execution time (dynamic content). Recurring tasks use 5-field cron expressions (minute hour day month weekday).",
    inputSchema: z.object({
      description: z.string().describe("Human-readable summary, e.g. 'Post standup reminder'"),
      action_type: z
        .enum(["message", "agent"])
        .describe("'message' for static text, 'agent' for AI-generated content"),
      channel_id: z.string().describe("Target Discord channel ID"),
      content: z
        .string()
        .optional()
        .describe("Message text (required if action_type is 'message')"),
      prompt: z.string().optional().describe("Agent prompt (required if action_type is 'agent')"),
      schedule_type: z.enum(["once", "recurring"]),
      run_at: z.string().optional().describe("ISO 8601 datetime for one-time tasks"),
      cron: z
        .string()
        .optional()
        .describe("5-field cron expression for recurring tasks (e.g. '0 9 * * 1-5')"),
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone (default: America/Indiana/Indianapolis)"),
      user_id: z.string().describe("Discord user ID of the person requesting this task"),
    }),
    execute: async ({
      description,
      action_type,
      channel_id,
      content,
      prompt,
      schedule_type,
      run_at,
      cron,
      timezone,
      user_id,
    }) => {
      const action: TaskAction =
        action_type === "message"
          ? { type: "message", channelId: channel_id, content: content ?? "" }
          : { type: "agent", channelId: channel_id, prompt: prompt ?? "" };

      const schedule: TaskSchedule = {
        type: schedule_type,
        at: schedule_type === "once" ? run_at : undefined,
        cron: schedule_type === "recurring" ? cron : undefined,
        timezone,
      };

      // Validate schedule before starting workflow
      try {
        if (schedule_type === "once" && run_at) {
          if (new Date(run_at) <= new Date()) return "Error: run_at must be in the future.";
        } else if (schedule_type === "recurring" && cron) {
          nextOccurrence(cron, new Date(), timezone);
        } else {
          return "Error: provide run_at for one-time tasks or cron for recurring tasks.";
        }
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }

      // Start the workflow — it self-registers with its runId via getWorkflowMetadata()
      const run = await start(taskWorkflow, [
        {
          meta: {
            description,
            action,
            schedule,
            context: {
              userId: user_id,
              channelId: channel_id,
              memberRoles: context.memberRoles,
            },
            createdAt: new Date().toISOString(),
          },
        },
      ]);

      const tz = timezone ?? "America/Indiana/Indianapolis";
      let nextRunStr: string;
      if (schedule_type === "once" && run_at) {
        nextRunStr = new Date(run_at).toLocaleString("en-US", { timeZone: tz });
      } else if (cron) {
        nextRunStr = nextOccurrence(cron, new Date(), timezone).toLocaleString("en-US", {
          timeZone: tz,
        });
      } else {
        nextRunStr = "unknown";
      }

      return `Scheduled "${description}" (ID: ${run.runId}). Next run: ${nextRunStr}.`;
    },
  });
}

export const listScheduledTasks = tool({
  description: "List active scheduled tasks. Optionally filter by the user who created them.",
  inputSchema: z.object({
    user_id: z.string().optional().describe("Filter by creator's Discord user ID"),
  }),
  execute: async ({ user_id }) => {
    const tasks = await listTasksFromRegistry(user_id ? { userId: user_id } : undefined);
    if (!tasks.length) return "No active scheduled tasks.";

    return tasks
      .map((t) => {
        const schedStr =
          t.schedule.type === "once"
            ? `once at ${t.schedule.at}`
            : `recurring (${t.schedule.cron})`;
        return `- **${t.description}** (ID: ${t.id}) — ${schedStr}, ${t.action.type} action`;
      })
      .join("\n");
  },
});

export const cancelTask = tool({
  description:
    "Cancel a scheduled task by its ID. This stops the workflow and removes the task from the registry.",
  inputSchema: z.object({
    task_id: z.string().describe("The task ID to cancel"),
  }),
  execute: async ({ task_id }) => {
    try {
      await getRun(task_id).cancel();
    } catch {
      // Workflow may already be completed/cancelled
    }
    await removeTask(task_id);
    return `Task ${task_id} cancelled.`;
  },
});
