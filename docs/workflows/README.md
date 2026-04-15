# Workflows & scheduling

Anything that needs to outlive a single function invocation runs inside a Workflow DevKit workflow. Two workflows exist:

- **`chatWorkflow`** — multi-turn conversations. Suspends between user messages.
- **`taskWorkflow`** — scheduled jobs. Suspends on a timer, can run once or recur.

Both live in `src/workflows/`.

## Why Workflow DevKit

Plain Vercel Functions are stateless and time-bounded. A Discord conversation can span hours; a recurring task can span weeks. Workflow DevKit gives us:

- **Durable suspension** at hooks (event-driven) and sleeps (time-driven) — the workflow's local state is checkpointed and rehydrated when it resumes.
- **Survives redeploys** — a workflow started before a deploy continues running on the new version.
- **Cancellation** — `getRun(runId).cancel()` aborts a running workflow.

We use it for the two cases above and nothing else; one-off operations stay in plain handlers.

## Contents

| Doc                                | Topic                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------- |
| [chatWorkflow](./chat.md)          | Multi-turn conversation workflow, hooks, state lifetime.                   |
| [taskWorkflow](./task.md)          | Scheduled task workflow, `TaskMeta`, registry, cron parsing, cancellation. |
| [Scheduled tasks](./scheduling.md) | The orchestrator's `scheduleTask`/`listScheduledTasks`/`cancelTask` tools. |

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

task:
  scheduleTask tool ──▶ start(taskWorkflow, [{ meta }])
                            │
                            ▼
                      persistTask
                            │
                            ▼
                      computeNextRun
                            │
                            ▼
                      sleep(target) → suspend
                            │
                            ▼
                      executeAction
                            │
                  ┌─────────┴─────────┐
                  │                   │
                "once"           "recurring"
                  │                   │
                  ▼                   ▼
             cleanupTask        checkTask + loop
```

## Where to look in the code

| File                         | What it is                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `src/workflows/chat.ts`      | `chatWorkflow`, `runTurn`, `cleanupConversation`, the inline `ChatHookEvent` type            |
| `src/workflows/task.ts`      | `taskWorkflow`, `persistTask`, `computeNextRun`, `executeAction`, `checkTask`, `cleanupTask` |
| `src/workflows/types.ts`     | `ChatPayload`, `TaskPayload`                                                                 |
| `src/lib/tasks/types.ts`     | `TaskMeta`, `TaskAction`, `TaskSchedule`, `TaskContext`                                      |
| `src/lib/tasks/registry.ts`  | `saveTask`, `getTask`, `listTasks`, `removeTask`                                             |
| `src/lib/tasks/cron.ts`      | `nextOccurrence` (cron parser with IANA timezone support)                                    |
| `src/lib/ai/tools/schedule/` | `scheduleTask`, `listScheduledTasks`, `cancelTask` tool definitions                          |
| `src/app/api/tasks/route.ts` | The `tasks` queue consumer (Vercel Queue trigger)                                            |
