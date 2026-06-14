# Observability

How errors, traces, logs, cron monitors, cost, and user feedback flow into
Sentry. Everything here describes what the code actually emits — the metric,
attribute, and span names are the ones in `src/`.

The app runs at low volume (a single guild), so the config captures
**everything**: `tracesSampleRate` is a flat `1.0` in both
`sentry.server.config.ts` and `sentry.edge.config.ts`, and there is no log-level
or sampling restriction. A sampled-out trace would be a gap exactly when we're
debugging a rare event, and full sampling keeps a distributed trace from ever
being partially captured.

## The four pipelines

### Errors → Sentry Issues

There is one error-reporting path: `createWideLogger(...).error(err)`
(`src/lib/logging/wide.ts`) forwards to `Sentry.captureException` before
delegating to evlog. Every `logger.error` site — `runInstrumented`'s catch, the
gateway `relay()` catch, the queue consumer, `processEvent`, the subagent
error path — becomes a Sentry issue with no extra code.

Do **not** add a bare `captureException` next to a `logger.error`; that
double-reports the same error.

### Traces

One trace now spans gateway relay → queue consume → workflow → orchestrator
(`gen_ai.invoke_agent`) → subagent → tool call, and scheduled-task creation →
fire:

- `relay()` (`src/server/routes/gateway/index.ts`) opens a **detached root
  span** per packet via `withDetachedRootSpan`. Detaching matters because the
  discord.js client is held across the ~10-minute gateway hold, so its socket
  callbacks would otherwise inherit the keepalive request's stale trace
  context. It then serializes the new context with `captureTraceparent()` onto
  the packet (`traceparent`, added once in the `definePacketEvent` factory so
  every variant carries it, optional both directions for rollout safety).
- The consumer (`src/app/api/discord/events/route.ts`) joins it with
  `withSpanFromParent(packet.traceparent, "discord.event", …)`.
- Scheduled tasks carry `traceparent` **only from the creating tool call**
  (`src/lib/ai/tools/schedule/index.ts`), linking a fire back to the
  conversation that scheduled it. Checkpoint hops, recurring re-fires, and the
  sweep intentionally start fresh — re-propagating on every re-enqueue would
  chain a recurring task into one unbounded trace spanning weeks.
- AI spans (`gen_ai.*`) come from `vercelAIIntegration({ force: true, … })`.
  `force` is required because the `ai` package is bundled by Next, so the
  integration's require-hook never sees it. These spans power the **AI Agents
  Insights** module.

The OTEL trace id is printed in every finalized bot reply footer, so any Discord
message can be pasted straight into Sentry's trace search.

### AI conversation traces

`runTurn` (`src/workflows/chat.ts`) calls `Sentry.setConversationId(workflowRunId)`
before the agent runs, so every `gen_ai` span inherits `gen_ai.conversation.id`.
Re-setting the same `workflowRunId` on each followup turn groups a whole
multi-turn conversation under one entry in AI Agents Insights. `workflowRunId`
is also the `chat.id` span attribute, so a conversation is one trace-explorer
query (`chat.id == <workflowRunId>`).

### Wide events → Sentry Logs

evlog wide events drain to **Sentry Logs** via a single `drain` on the global
evlog logger (`src/lib/evlog.ts`): every wide event — `createWideLogger().emit()`,
the request logger, and the global `log.*` tagged logs in production — is
forwarded to `Sentry.logger[level](message, attributes)` with its fields
preserved as **queryable attributes**. The drain runs inside evlog's emit, so
the active span is current and Sentry joins each log to its trace (and
`createWideLogger` stamps an explicit `trace.id`). evlog redacts PII before the
drain fires; stdout is left intact so Vercel's own log capture still works.

This replaces the `consoleLoggingIntegration` approach, which would only see the
JSON string evlog prints and capture it as opaque text. Query in **Explore →
Logs** by `op` (`ai.turn`, `gateway.relay`, `discord.event.callback`,
`ai.subagent`, `ai.feedback`, …).

### Cron monitors (Check-Ins)

- Every cron handler is covered by one `Sentry.withMonitor` at the dispatch
  chokepoint (`src/server/routes/crons.ts`); the **monitor slug is the cron
  name** and the schedule is the handler's own crontab.
- The gateway listener has its own monitor, slug **`discord-gateway`**
  (`*/9 * * * *`, mirroring the keepalive in `vercel.ts`). If its check-ins
  stop, the bot is deaf.
- `automaticVercelMonitors` was removed from `next.config.ts` — it read a
  `vercel.json` crons block that doesn't exist (crons run via Hono routes) and
  is Pages-Router-only.

## Cost attribution

Cost reuses the existing models.dev pricing system (`fetchModelInfo` /
`ModelInfo.cost`), not a hand-maintained table. `src/lib/ai/models-dev.ts`
memoizes the catalog behind a synchronous, non-blocking `lookupModelInfoCached`;
`streamTurn` fires `warmModelCatalog()` when a turn begins so the catalog is warm
by finalize. The hot path never blocks on or fails from the network — a
cold-start turn simply omits cost until the catalog lands.

- Each subagent delegation is priced at its **own** model (the code domain runs
  Opus, others a mini — orders of magnitude apart): metric `ai.subagent.cost_usd`
  (attrs `{domain, model}`), folded into the turn total.
- `ai.turn.cost_usd` = orchestrator (priced at the model that actually ran,
  fallback included) + summed subagent costs; mirrored onto the `chat.turn` span
  as `ai.cost_usd` and the turn's wide event. Gated on the orchestrator price
  being known, so the metric is whole-turn or absent — never a misleading
  subagent-only partial.

Cost is priced at the full input rate (the catalog carries no cache-read rate),
consistent with the `/inspect-context` breakdown.

## Feedback capture

Closing the loop from a reaction on a bot reply back to the exact turn:

- At finalize, `streamTurn` writes `turn-message:<discordMessageId>` →
  `{chatId, traceId, channelId, userId}` to Redis (7-day TTL, `TurnMessageStore`
  in `src/bot/turn-message-store.ts`) for the primary reply and every overflow
  chunk. Persistence is non-fatal — a failure counts `ai.feedback.index_error`
  and the turn still succeeds.
- The `feedback` reaction handler (`src/bot/handlers/events/feedback/`) looks the
  message up; a miss means "not a bot turn reply" (the lookup **is** the
  bot-authored filter). On a hit it emits metric `ai.feedback` (attrs
  `{emoji, positive}` from a small sentiment map) and wide event `op:"ai.feedback"`
  with `message_id`, `emoji`, `user_id`, `chat_id`, `trace_id` — joinable to the
  turn's trace and conversation.

## Alerts to configure (Sentry UI, one-time)

Alerts cannot be created from code. After the first deploy registers the
monitors:

1. Missed check-in on **every cron slug** and missed/failed check-in on
   **`discord-gateway`** (Insights → Crons → monitor → Alerts).
2. Metric alert on `ai.turn.cost_usd` daily sum exceeding budget.
3. Metric alert on `gateway.listener.login_failed` > 0 in 15 min.
