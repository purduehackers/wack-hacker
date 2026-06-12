# Observability

How errors, traces, logs, metrics, cron monitors, and user feedback flow into
Sentry, and the dashboards/alerts worth building on top of them. Everything
here describes what the code actually emits — metric and attribute names are
the ones in `src/`.

## The four pipelines

### Errors → Sentry Issues

There is exactly **one** error-reporting path: `createWideLogger(...).error(err)`
(`src/lib/logging/wide.ts`) forwards to `Sentry.captureException` before
delegating to evlog. Every existing `logger.error` site — `runInstrumented`'s
catch, the gateway `relay()` catch, the queue consumer, `processEvent`, and
every other wide-event op — becomes a Sentry issue with no extra code.

Do **not** add bare `captureException` calls next to a `logger.error` call;
that double-reports the same error.

The queue consumer (`src/app/api/discord/events/route.ts`) wraps its
`logger.error` in `Sentry.withScope` so issues there are **fingerprinted by
packet type** and tagged `queue.terminal: "true"` on the attempt that
dead-letters the message (`deliveryCount >= 3`).

### Traces

One trace now spans gateway relay → queue consume → workflow → orchestrator
(`gen_ai.invoke_agent`) → subagent → tool call:

- `relay()` (`src/server/routes/gateway/index.ts`) opens a **detached root
  span** per packet via `withDetachedRootSpan` — detaching matters because the
  discord.js socket callbacks otherwise inherit the keepalive request's stale
  trace context and its sampling decision — then serializes the new context
  with `captureTraceparent()` onto the packet (`traceparent` field, optional on
  all seven packet schemas in `src/lib/protocol/packets.ts`).
- The consumer joins it with `withSpanFromParent(packet.traceparent, "discord.event", …)`.
- Scheduled tasks carry `traceparent` **only from the creating tool call**
  (`src/lib/ai/tools/schedule/index.ts`). Checkpoint hops and recurring
  re-enqueues intentionally start fresh traces — re-propagating would chain a
  recurring task into one unbounded trace spanning weeks.
- AI spans (`gen_ai.*`) come from `vercelAIIntegration({force: true, …})` in
  `sentry.server.config.ts`. `force` is required because the `ai` package is
  bundled by Next, so the integration's require-hook never sees it. These
  spans power the **AI Agents Insights** module.

Sampling (`tracesSampler` in `sentry.server.config.ts`): development 1.0;
propagated traces follow `parentSampled`; the gateway keepalive route 0.01
(~160 no-value invocations/day); `/api/crons/` routes and roots named
`gateway.relay` / `discord.event` / `chat.*` / `workflow*` /
`scheduled_task.fire` 1.0; everything else 0.1.

The OTEL trace id is printed in every finalized bot reply footer, so any
Discord message can be pasted straight into Sentry's trace search.

### Wide events → Sentry Logs

evlog wide events are JSON lines on stdout; `consoleLoggingIntegration`
captures them into **Sentry Logs**. `createWideLogger` injects the active
`trace.id` into every emit, so log lines join their trace in the UI. Query
wide events in **Explore → Logs**, e.g. ops like `ai.turn`, `gateway.relay`,
`discord.event.callback`, `ai.feedback`.

### Cron monitors (Check-Ins)

- Every cron handler is covered by one `Sentry.withMonitor` at the dispatch
  chokepoint (`src/server/routes/crons.ts`); the **monitor slug is the cron
  name** (`heartbeat`, `hack-night-create`, `hack-night-cleanup`, …).
- The gateway listener has its own monitor, slug **`discord-gateway`**
  (`*/9 * * * *`, mirroring `vercel.ts`). If its check-ins stop, the bot is
  deaf.
- `automaticVercelMonitors` was removed from `next.config.ts` — it read a
  `vercel.json` that doesn't exist and is Pages-Router-only. Monitors are
  explicit now.

**Alerts cannot be created from code.** In Sentry: **Insights → Crons** →
select the monitor → **Alerts → Create Alert**, condition *missed check-in*
(also add *failed check-in* for `discord-gateway`). Do this once per slug
after the first deploy registers them.

## Cost attribution

A static price table (`src/lib/ai/pricing.ts`, USD per MTok, input/output/
cache-read rates per gateway model slug) feeds `estimateCostUsd`. The AI SDK's
`inputTokens` includes cache reads, so cached tokens are subtracted and
re-priced at the cache-read rate. Unknown model slugs emit
`ai.cost.unknown_model` (count, attrs `{model, domain?}`) instead of a wrong
number — **extend the table when adding a model**.

| Metric | Type | Attributes |
| --- | --- | --- |
| `ai.turn.cost_usd` | distribution | `model`, `user` (hashed bucket) |
| `ai.subagent.cost_usd` | distribution | `domain`, `model` |
| `ai.turn.tokens` / `.tool_calls` / `.steps` | distribution | `model`, `user` |
| `ai.subagent.tokens` / `.input_tokens` / `.output_tokens` / `.cached_input_tokens` / `.tool_calls` | distribution | `domain`, `model` |
| `ai.subagent.completed` | count | `domain`, `model` |

The `user` attribute is a stable 16-way hash bucket (`u00`–`u15`,
`bucketUserId` in `src/lib/ai/streaming.ts`) — **never put raw user ids in
metric attributes** (unbounded cardinality); raw ids are fine on wide events.

`ai.subagent.cached_input_tokens` is the verification metric for prompt-cache
work: it should be > 0 on step 2+ once caching layers correctly.

Spans mirror the totals: `chat.turn` carries `ai.cost_usd`,
`ai.cached_input_tokens`, and the token/tool/step attributes.

## Feedback capture

Closing the loop from a reaction on a bot reply back to the exact turn:

- At finalize time, `streamTurn` writes `turn-message:<discordMessageId>` →
  `{chatId, traceId, domains, channelId, userId}` to Redis (7-day TTL,
  `TurnMessageStore` in `src/bot/turn-message-store.ts`), for the primary
  reply and every overflow chunk. Persistence is non-fatal — failures count
  `ai.feedback.index_error` and the turn still succeeds.
- The `feedback` reaction handler (`src/bot/handlers/events/feedback/`) looks
  the message up; a miss means "not a bot turn reply" (the lookup **is** the
  bot-authored filter). On a hit it emits:
  - metric `ai.feedback` (count, attrs `{emoji, positive}` where positive is
    `"true"` / `"false"` / `"unknown"` from a small sentiment map), and
  - wide event `op:"ai.feedback"` with `message_id`, `emoji`, `user_id`,
    `chat_id`, `trace_id`, `domains` — joinable to the turn's trace and to
    cost/usage by `trace_id` / `chat_id`.

## Dashboards worth building

All metric queries live in **Explore → Metrics** (trace-metrics); log queries
in **Explore → Logs**; trace queries in **Explore → Traces**.

| Dashboard | Query |
| --- | --- |
| Cost / day by model & domain | `ai.turn.cost_usd` summed, grouped by `model`; `ai.subagent.cost_usd` grouped by `domain`, `model` |
| Cache hit ratio | `ai.subagent.cached_input_tokens` ÷ `ai.subagent.input_tokens`, by `domain` (also `ai.cached_input_tokens` vs `ai.input_tokens` on `chat.turn` spans) |
| Subagent activity & failure proxy | `ai.subagent.completed` by `domain`, `model`; failures appear as issues from the `ai.subagent` wide-event path (dedicated failure metrics land with the subagent-resilience plan) |
| Step-cap exhaustion | `ai.subagent.completed` filtered where `ai.turn.steps` ≈ the spec's `stopSteps`; spikes mean truncated work |
| Queue dead-letters | Issues tagged `queue.terminal:true`, grouped by fingerprint (= packet type); rate via `discord.event.callback_error` by `type` |
| Cron health | Crons page (slugs above); plus `cron.completed` / `cron.error` by `name` and `cron.duration` |
| Gateway blackouts | `gateway.listener.hold_duration` gaps, `gateway.leader.lost`, `gateway.listener.login_failed`; monitor `discord-gateway` missed check-ins are the alert |
| Feedback | `ai.feedback` by `positive`, `emoji`; drill into a reaction via its wide event's `trace_id` |
| Approval latency / timeout rate | no metrics yet — lands with the approvals-hardening plan; today approvals are visible only in `chat.turn` traces |

## Alerts to configure (Sentry UI, one-time)

1. Missed check-in on **every cron slug** and missed/failed check-in on
   **`discord-gateway`** (Insights → Crons → monitor → Alerts).
2. Issue alert on new issues tagged `queue.terminal:true` (a packet was
   dead-lettered after 3 attempts).
3. Metric alert on `ai.turn.cost_usd` daily sum exceeding budget.
4. Metric alert on `gateway.listener.login_failed` > 0 in 15 min.
