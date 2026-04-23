# Scheduled tasks

The orchestrator exposes three scheduling tools, all in `src/lib/ai/tools/schedule/`. They're base tools (not part of the skill system), so they're available at every turn.

## Architecture

Scheduling runs on **Vercel Queue + Turso**, not Vercel Workflow. A one-line summary:

> `schedule_task` enqueues a queue message with `delaySeconds`; when it delivers, the handler reads the `scheduled_tasks` row, fires the action, and (for recurring) enqueues the next occurrence.

Key pieces:

- **Storage**: `scheduled_tasks` table (`src/lib/db/schemas/scheduled-tasks.ts`) — the authoritative record for each task. Columns include `status`, `nextRunAt`, `queueMessageId`, `lastFiredAt`, `fireCount`, and `maxDriftMs` for observability.
- **DB helpers**: `src/lib/tasks/db.ts` — `saveScheduledTask`, `getScheduledTask`, `updateScheduledTask`, `listScheduledTasks`.
- **Queue wake-ups**: `src/lib/tasks/queue/schedule-fire.ts` — `sendScheduledFire(taskId, target, delaySec)`. Clamps `delaySeconds` to 6d and sets `retentionSeconds=7d`. Stamps `idempotencyKey = "${taskId}:${targetIso}"` so tool retries / duplicate sends collapse into one.
- **Fire handler**: `src/lib/tasks/queue/handlers/scheduled-task-fire.ts` — single handler for `task: "scheduled-task-fire"`. Short-circuits if the row is missing, cancelled, or superseded; otherwise records drift, executes the action, and either marks completed (one-time) or enqueues the next occurrence (recurring).
- **Cron parser**: `src/lib/tasks/cron.ts` — hand-rolled next-occurrence for 5-field cron expressions. Default timezone is `America/New_York`.

The queue used is the same `tasks` topic served by `src/app/api/tasks/route.ts`, alongside the existing `send-message` task. Visibility timeout on that route is `600s` so agent-action fires don't get redelivered mid-stream.

## Tools

| Tool                   | What it does                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schedule_task`        | Validates input, computes the target instant, enqueues a `sendScheduledFire`, then inserts the `scheduled_tasks` row. Wrapped with `approval()`. |
| `list_scheduled_tasks` | Reads from `listScheduledTasks(opts?)`, optionally filtered by user. Returns only rows with `status='active'`.                                   |
| `cancel_task`          | `updateScheduledTask(id, { status: 'cancelled', nextRunAt: null })`. Leftover queue messages no-op when delivered. Wrapped with `approval()`.    |

## Long horizons

`@vercel/queue` caps `delaySeconds` at 7 days. `sendScheduledFire` clamps to 6 days; if the real horizon is longer, the handler detects early delivery (`Date.now() < targetMs - 5s`) and re-enqueues the remaining delay. Each hop is one DB read + one queue send. A 30-day schedule takes 5 hops; a year takes ~62.

The `idempotencyKey = "${taskId}:${targetIso}"` prevents double-enqueue. Since hops are ≥6 days apart and the queue's idempotency dedup window is 24h, the key naturally re-registers between hops.

## Failure modes

- **Send succeeds, DB insert fails**: the queue message fires, the handler finds no row, returns silently. Tool throws up to the caller.
- **DB insert succeeds, send fails**: not possible — send goes first. If `updateScheduledTask` for `queueMessageId` fails after send, `queueMessageId` stays null; it's debug metadata and doesn't gate firing.
- **Handler throws mid-fire**: the route releases its dedup marker on throw, so the queue's retry can re-enter. Inside the handler, `claimFire(taskId, targetIso)` atomically bumps `lastFiredAt` before the Discord/agent side effect — a retry after the action already ran sees the existing claim and short-circuits, so at-least-once queue delivery never double-posts.
- **Late recurring fires**: `finalizeFire` computes the next occurrence anchored to the original `targetIso`. If that occurrence is already in the past (fire ran long after its scheduled slot), the handler recomputes the next occurrence from `now()` so a minutely task that fires 10 minutes late resumes at the next future minute instead of replaying 10 back-to-back backfills. Emits `scheduled_task.recurring_intervals_skipped`.
- **Cancellation race**: once the handler reads `status='active'`, it runs to completion. A simultaneous `cancel_task` sets `status='cancelled'`; the next wake-up sees it and no-ops.
- **Invalid cron at re-enqueue time**: handler sets `status='failed'` and throws so the error surfaces in Sentry.
- **Partial-write on recurring re-enqueue**: `finalizeFire` sends the next queue message before updating the row. If the DB write fails after the send, the row is left pointing at the old target while the queue already carries the new one. The supersede check uses `row.nextRunAt > targetIso` (ISO 8601 sorts lexicographically), so a stale row that's _behind_ the delivered `targetIso` still fires — the chain self-heals. A row that's _ahead_ of `targetIso` is still treated as superseded (normal redelivery dedup).

## Observability

Per-fire metrics emitted from the handler:

- `scheduled_task.fire_drift_ms` (distribution) — `Date.now() - targetMs`. Tagged by `schedule_type` and `action_type`.
- `scheduled_task.completed` — counter on one-time completion.
- `scheduled_task.recurring_rescheduled` — counter on recurring re-enqueue.
- `scheduled_task.checkpoint_hop` — counter when the handler detects an early delivery and re-enqueues.
- `scheduled_task.recurring_parse_error` — counter on invalid-cron failures.
- `scheduled_task.action_error` — counter when the action throws.

Row-level: `scheduled_tasks.fireCount`, `lastFiredAt`, and `maxDriftMs` are updated on every fire so you can spot-check drift per task.
