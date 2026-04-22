# taskWorkflow

`src/workflows/task.ts`. Scheduled jobs — one-shot or recurring — that can send a canned Discord message or run the orchestrator against a prompt.

## Payload

```ts
type TaskPayload = {
  meta: Omit<TaskMeta, "id">;
};
```

The workflow uses its own `workflowRunId` as the task's persistent ID, so the task can be looked up later for cancellation.

## TaskMeta

```ts
type TaskMeta = {
  id: string; // = workflowRunId
  description: string; // human-readable
  action:
    | { type: "message"; channelId: string; content: string }
    | { type: "agent"; channelId: string; prompt: string };
  schedule:
    | { type: "once"; at: string /* ISO 8601 */ }
    | { type: "recurring"; cron: string; timezone?: string };
  context: { userId: string; channelId: string };
  createdAt: string; // ISO 8601
};
```

## Registry

`src/lib/tasks/registry.ts` persists tasks in Redis under three keys:

| Key                    | Purpose                                 |
| ---------------------- | --------------------------------------- |
| `task:${id}`           | The full `TaskMeta` blob.               |
| `tasks:all`            | Set of every task ID, for global lists. |
| `tasks:user:${userId}` | Set of one user's task IDs.             |

`saveTask`, `getTask`, `listTasks`, and `removeTask` all use these keys consistently. `listTasks({ userId })` uses a Redis pipeline to batch-fetch every task in the user's set.

## Workflow loop

Each named function below is its own `"use step"` so the workflow runtime checkpoints state across them.

1. **`persistTask(meta)`** writes the task to Redis via `saveTask()`.
2. **`computeNextRun(meta)`** parses `at` (one-time) or `cron` + `timezone` (recurring) into a `Date`.
3. **Sleep** until the target via Workflow API's durable `sleep(target)`.
4. **For recurring only:** call `checkTask(id)` (a step that wraps `getTask`). If the task is gone (cancelled), break out of the loop. The one-time path skips this check.
5. **`executeAction(meta)`**:
   - `message` → sends `content` to `channelId`.
   - `agent` → builds a synthetic `AgentContext` with username `"system"` and nickname `"Scheduled Task"`, then calls `streamTurn(discord, channelId, prompt, context.toJSON())`.
6. **Loop**: recurring schedules go back to step 2 with a freshly-computed next target. One-time schedules call `cleanupTask(id)` and exit.

## Cron parsing

`src/lib/tasks/cron.ts` exports `nextOccurrence(cron, after, timezone?)`. It's a hand-written 5-field parser supporting `*`, ranges, lists, and steps. The default timezone is `America/Indiana/Indianapolis` (Purdue's local time); the parser correctly handles DST by converting between UTC and the target zone. It searches up to 4 years ahead and throws if no match is found.

## Cancellation

Two ways to cancel a task:

1. The orchestrator's `cancel_task` tool calls `getRun(taskId).cancel()` followed by `removeTask(taskId)` — see [Scheduled tasks](./scheduling.md).
2. Anything that removes the task from the registry (e.g. an admin script) will be picked up on the recurring loop's next wake.

The recurring loop's `checkTask` recheck after sleep is what makes external removal work — the workflow exits gracefully instead of executing a deleted task. For one-shot tasks, external removal won't stop execution unless the workflow is also cancelled via `getRun`, because the one-shot path skips the recheck.

## Synthetic AgentContext for scheduled agents

Scheduled agent tasks don't have a real user turn, so `executeAction` fabricates an `AgentContext`:

```ts
const context = AgentContext.fromJSON({
  userId: meta.context.userId,
  username: "system",
  nickname: "Scheduled Task",
  channel: { id: meta.action.channelId, name: "scheduled" },
  date: now.toLocaleDateString("en-US", {
    /* weekday, year, month, day */
  }),
});
```

The orchestrator's `<execution_context>` block will show `user.username: "system"` so the model knows this isn't a live conversation.
