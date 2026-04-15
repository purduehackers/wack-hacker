# Scheduled tasks

The orchestrator exposes three scheduling tools, all in `src/lib/ai/tools/schedule/`. They're base tools (not part of the skill system), so they're available at every turn.

## Tools

| Tool                  | What it does                                                                            |
| --------------------- | --------------------------------------------------------------------------------------- |
| `scheduleTask`        | Validates the schedule (future date or parseable cron) and starts a `taskWorkflow`.     |
| `listScheduledTasks`  | Reads from `registry.listTasks(opts?)`, optionally filtered by user.                    |
| `cancelTask`          | Cancels the workflow run and removes the registry entry.                                |

## scheduleTask

Inputs (via Zod schema):

- `description: string` — human-readable summary.
- `action_type: "message" | "agent"` — whether to send canned content or run the orchestrator.
- `channel_id: string` — where the action runs.
- `content?: string` / `prompt?: string` — mutually exclusive; matches `action_type`.
- `schedule_type: "once" | "recurring"`.
- `run_at?: string` (ISO 8601) / `cron?: string` — mutually exclusive; matches `schedule_type`.
- `timezone?: string` — IANA timezone, default `America/Indiana/Indianapolis`.
- `user_id: string` — owning user (for `tasks:user:<id>` indexing).

The tool validates the schedule before starting the workflow: `run_at` must parse as a future date, and `cron` must parse via `nextOccurrence`. On success it calls `start(taskWorkflow, [{ meta }])` and returns a confirmation message with the next run time.

## listScheduledTasks

Calls `listTasks(opts?)` with an optional `user_id` filter. Returns a formatted list with each task's ID, description, schedule, and next run time. Use this for "what do I have coming up?" style queries.

## cancelTask

```ts
await getRun(task_id).cancel(); // wrapped in try/catch — workflow may already be gone
await removeTask(task_id);
```

The try/catch exists because a just-cancelled workflow might not be queryable anymore, and we still want to remove the registry entry. Returns `"Task <id> cancelled."`.

## Why tools don't touch the queue directly

Tools never directly enqueue to the `tasks` queue — they always go through `start(taskWorkflow, …)`, which is the API that produces a durable run with a known ID. The `tasks` queue itself is only the consumer trigger that wakes the workflow when its sleep elapses.

Scheduling is one-way: tools `start` workflows, the queue wakes workflows, workflows execute actions and optionally loop. You should never need to publish to the `tasks` queue from your own code — that's Workflow DevKit's job.
