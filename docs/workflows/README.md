# Workflows & scheduling

Two distinct durability primitives live in this repo:

- **`chatWorkflow`** (Workflow DevKit) — multi-turn Discord conversations. Suspends between user messages via hooks.
- **Scheduled tasks** (Vercel Queue + Turso) — one-time or recurring reminders. Persisted as rows in `scheduled_tasks`; fired by queue wake-ups.

`chatWorkflow` is in `src/workflows/`. Scheduled tasks live under `src/lib/tasks/` and `src/lib/ai/tools/schedule/`.

## Why different primitives

- **Conversations need hooks**, not timers. Workflow DevKit's `createHook()` is the right tool: the workflow parks on an event, resumes when the user replies, and a deploy between turns doesn't lose state.
- **Scheduled tasks need precise wake-ups**. Workflow DevKit's `sleep()` is durable but not precise — wake-ups go through Vercel's beta workflow queue and can drift by minutes. `@vercel/queue` `delaySeconds` delivers within seconds of the target, which is what users actually expect for reminders.

## Contents

| Doc                                | Topic                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [chatWorkflow](./chat.md)          | Multi-turn conversation workflow, hooks, state lifetime.                                                                                    |
| [Scheduled tasks](./scheduling.md) | Queue + Turso architecture, the `schedule_task` / `list_scheduled_tasks` / `cancel_task` tools, drift metrics, cancellation, long horizons. |

## Lifecycle at a glance

```
chat:
  new conversation:
    mention handler ──▶ start(chatWorkflow, [payload])
                            │
                            ▼
                      runTurn (initial)
                            │
                            ▼
                      createHook → suspend
                            ▲
                            │
  follow-up message:        │
    mention or message ─────┘  resumeHook(workflowRunId, event)
                            │
                            ▼
                      runTurn → suspend → ...
                            │
                      "done" or expired
                            │
                            ▼
                       cleanup

scheduled task:
  schedule_task tool ─▶ sendScheduledFire(id, target, delaySec)
                            │                              ▲
                            │                              │ (re-enqueue
                            ▼                              │  for horizons
                      INSERT scheduled_tasks               │   past 6d,
                            │                              │  or for next
                            ▼                              │  recurring
                      queue delivers after delaySeconds ───┘  occurrence)
                            │
                            ▼
                      scheduled-task-fire handler
                            │
                   ┌────────┴────────┐
                   │                 │
                 "once"         "recurring"
                   │                 │
                   ▼                 ▼
              status=completed   enqueue next
```

## Where to look in the code

| File                                                  | What it is                                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/workflows/chat.ts`                               | `chatWorkflow`, `runTurn`, `cleanupConversation`, the inline `ChatHookEvent` type        |
| `src/workflows/types.ts`                              | `ChatPayload`, `ChatHookEvent`                                                           |
| `src/lib/db/schemas/scheduled-tasks.ts`               | Drizzle schema for `scheduled_tasks`                                                     |
| `src/lib/tasks/db.ts`                                 | `saveScheduledTask`, `getScheduledTask`, `updateScheduledTask`, `listScheduledTasks`     |
| `src/lib/tasks/types.ts`                              | `TaskAction` JSON shape                                                                  |
| `src/lib/tasks/cron.ts`                               | `nextOccurrence` (cron parser with IANA timezone support)                                |
| `src/lib/tasks/queue/schedule-fire.ts`                | `sendScheduledFire` — queue send helper with 6-day checkpoint + idempotency key          |
| `src/lib/tasks/queue/handlers/scheduled-task-fire.ts` | The fire handler: status checks, drift metric, action execution, re-enqueue / completion |
| `src/lib/ai/tools/schedule/`                          | `schedule_task`, `list_scheduled_tasks`, `cancel_task` tool definitions                  |
| `src/app/api/tasks/route.ts`                          | The `tasks` queue consumer (Vercel Queue trigger); dispatches by `envelope.task`         |
