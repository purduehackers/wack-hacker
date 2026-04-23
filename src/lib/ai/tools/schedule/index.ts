import { tool } from "ai";
import { ulid } from "ulid";
import { z } from "zod";

import type { TaskAction } from "@/lib/tasks/types";

import { DEFAULT_TIMEZONE } from "@/lib/tasks/constants";
import { listScheduledTasks, saveScheduledTask, updateScheduledTask } from "@/lib/tasks/db";
import { ScheduledTaskStatus, ScheduleType } from "@/lib/tasks/enums";
import { sendScheduledFire } from "@/lib/tasks/queue/schedule-fire";

import type { AgentContext } from "../../context.ts";

import { nextOccurrence } from "../../../tasks/cron.ts";
import { approval } from "../../approvals/index.ts";

interface ScheduleInput {
  action_type: "message" | "agent";
  content?: string;
  prompt?: string;
  schedule_type: ScheduleType;
  run_at?: string;
  cron?: string;
  timezone?: string;
}

// `offset: true` accepts both `Z` and `+HH:MM` suffixes. Without this the
// zod default rejects anything other than `Z`.
const ISO_DATETIME_SCHEMA = z.string().datetime({ offset: true });

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns an error string if the input is invalid, or `null` if it's ready to
 * schedule. Kept out of the tool body to keep `createScheduleTask` small.
 */
function validateScheduleInput(input: ScheduleInput): string | null {
  const { action_type, content, prompt, schedule_type, run_at, cron, timezone } = input;

  if (action_type === "message" && !content?.trim()) {
    return "Error: content is required when action_type is 'message'.";
  }
  if (action_type === "agent" && !prompt?.trim()) {
    return "Error: prompt is required when action_type is 'agent'.";
  }

  if (timezone && !isValidTimezone(timezone)) {
    return `Error: invalid timezone "${timezone}". Use IANA format like "America/New_York".`;
  }

  try {
    if (schedule_type === "once" && run_at) {
      if (!ISO_DATETIME_SCHEMA.safeParse(run_at).success) {
        return "Error: run_at must be a valid ISO 8601 datetime (e.g. '2026-04-22T10:00:00Z').";
      }
      if (new Date(run_at) <= new Date()) return "Error: run_at must be in the future.";
    } else if (schedule_type === "recurring" && cron) {
      nextOccurrence(cron, new Date(), timezone);
    } else {
      return "Error: provide run_at for one-time tasks or cron for recurring tasks.";
    }
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
  return null;
}

/**
 * Build the schedule tool bound to the scheduler's `AgentContext`. The
 * closure captures `context.memberRoles` so the persisted row carries the
 * scheduler's Discord role IDs — without that, scheduled agent runs resolve
 * to `UserRole.Public` and lose access to every `delegate_*` subagent.
 */
export function createScheduleTask(context: AgentContext) {
  return approval(
    tool({
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
        schedule_type: z.enum([ScheduleType.Once, ScheduleType.Recurring]),
        run_at: z.string().optional().describe("ISO 8601 datetime for one-time tasks"),
        cron: z
          .string()
          .optional()
          .describe("5-field cron expression for recurring tasks (e.g. '0 9 * * 1-5')"),
        timezone: z.string().optional().describe(`IANA timezone (default: ${DEFAULT_TIMEZONE})`),
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
        const validationError = validateScheduleInput({
          action_type,
          content,
          prompt,
          schedule_type,
          run_at,
          cron,
          timezone,
        });
        if (validationError) return validationError;

        const action: TaskAction =
          action_type === "message"
            ? { type: "message", channelId: channel_id, content: content! }
            : { type: "agent", channelId: channel_id, prompt: prompt! };

        const tz = timezone ?? DEFAULT_TIMEZONE;
        const target =
          schedule_type === ScheduleType.Once
            ? new Date(run_at!)
            : nextOccurrence(cron!, new Date(), timezone);
        const delaySec = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));

        const id = ulid();
        // Send first: a failed send surfaces to the user immediately and
        // leaves no orphan DB row. If the save fails after a successful send,
        // the fire handler looks up a missing row and no-ops — no side effect.
        const { messageId } = await sendScheduledFire(id, target, delaySec);
        await saveScheduledTask({
          id,
          userId: user_id,
          channelId: channel_id,
          description,
          scheduleType: schedule_type,
          runAt: run_at ?? null,
          cron: cron ?? null,
          timezone: timezone ?? null,
          action,
          memberRoles: context.memberRoles ?? null,
          status: ScheduledTaskStatus.Active,
          nextRunAt: target.toISOString(),
          queueMessageId: messageId,
        });

        const nextRunStr = target.toLocaleString("en-US", { timeZone: tz });
        return `Scheduled "${description}" (ID: ${id}). Next run: ${nextRunStr}.`;
      },
    }),
  );
}

export const list_scheduled_tasks = tool({
  description: "List active scheduled tasks. Optionally filter by the user who created them.",
  inputSchema: z.object({
    user_id: z.string().optional().describe("Filter by creator's Discord user ID"),
  }),
  execute: async ({ user_id }) => {
    const tasks = await listScheduledTasks(user_id ? { userId: user_id } : undefined);
    if (!tasks.length) return "No active scheduled tasks.";

    return tasks
      .map((t) => {
        const schedStr =
          t.scheduleType === ScheduleType.Once ? `once at ${t.runAt}` : `recurring (${t.cron})`;
        return `- **${t.description}** (ID: ${t.id}) — ${schedStr}, ${t.action.type} action`;
      })
      .join("\n");
  },
});

export const cancel_task = approval(
  tool({
    description:
      "Cancel a scheduled task by its ID. This marks the task inactive so its next wake-up is a no-op.",
    inputSchema: z.object({
      task_id: z.string().describe("The task ID to cancel"),
    }),
    execute: async ({ task_id }) => {
      await updateScheduledTask(task_id, {
        status: ScheduledTaskStatus.Cancelled,
        nextRunAt: null,
      });
      return `Task ${task_id} cancelled.`;
    },
  }),
);
