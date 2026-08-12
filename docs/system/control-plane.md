# The conversation control plane

How a Discord message becomes a turn, what holds a conversation while it runs,
and what to build next. Written 2026-08-12 after a night in which nine defects
were found and fixed here; every fact below was verified against production
rather than read off the source.

Companion docs: [conversation-engine](./conversation-engine.md) for the durable
queue's history, [discord-and-bot](./discord-and-bot.md) for the gateway,
[control-plane-refactor](../control-plane-refactor.md) for the reasoning behind
the leases — including the part that turned out to be wrong.

## Why there are two processes

The **agent** is a Vercel durable workflow. Turns suspend and resume; a turn
parked on an approval holds no compute and can wait days. It cannot hold a
socket, and while a turn runs it is, from the outside, silent.

The **bot** is a long-lived process in a Vercel Sandbox holding a Discord
gateway connection. It can hold sockets and it owns every Discord write.

Neither can hold state for the other, so Redis is the coordination substrate and
Lua is how multi-key changes stay atomic. That is the whole reason this layer
exists. It is not incidental complexity, but it _was_ over-built, and the
measurements are in the refactor doc.

**The consequence that decides most designs here:** anything requiring a live
connection for the duration of a turn belongs to the bot, because the agent is
suspended for exactly that span.

## The lifecycle

Verified end to end by `bun run check:invariants`, which drives this sequence
through the real Lua:

```
enqueue          pending:<key> ← message          (agent:seen dedupes)
claim            agent:active ← phase=claimed     PX 48h, lease +30m
admission.start  phase → live                     ingress lease taken
admission.confirm sessionId ← wrun_…
publish(render)  intent ← revision N              lease refreshed +30m
settleAndPark    phase → parked                   lease → 24h, parked marker
(bot paints)     render-outcome ← "applied"
complete         agent:active deleted             index entry released
```

Every step is fenced. `dispatchId` and `messageId` must match, phases must be
legal, and a stale replay is refused rather than applied — Eve reports
`stepIndex: 0` _and_ `sequence: 0` for every step of a turn that suspends and
resumes, so neither can ever be used as a replay cursor.

## Redis, and the one record that matters

`agent:active:<conversation>` is the record that says a turn holds this
conversation. **Eleven Lua scripts across three files mutate it, fenced by six
different predicates.** That is the shape behind most defects found here: to
change it safely you must know all eleven, so a file-scoped audit is
structurally guaranteed to miss some.

Two mitigations, both load-bearing:

**One owner for the write.** `ACTIVE_RECORD_LUA` in `keys.ts` defines
`writeActive`, and every script that rewrites the record calls it. A new
invariant is added once rather than eight times.

**`KEEPTTL` on every write.** A bare `SET` clears a Redis expiry. This was
forgotten three times in one night — including in `wack:start-delivery`, which
runs on _every_ delivery and silently made the key immortal again moments after
`claim` had bounded it. If you add a write, use `writeActive`.

Invariants that live _inside_ the JSON survive automatically; every script
round-trips unknown fields through `cjson`. Invariants that live _outside_ it —
the key's expiry, index membership — must be re-asserted by every writer, and
nothing but the checker enforces that. **That distinction is the single most
useful thing to know before editing this directory.**

## Nothing is allowed to live forever

Every wedge found here reduced to a record that could not expire. The rule now
is that no state is unbounded:

| State                     | Bound  | Refreshed by            |
| ------------------------- | ------ | ----------------------- |
| A running turn            | 30 min | every published render  |
| A turn parked on a person | 24 h   | —                       |
| The key itself            | 48 h   | —                       |
| A superseded/stuck record | swept  | `wack:expire-admission` |

The running-turn lease is measured in **silence, not elapsed time**. An earlier
version capped from the claim, which would have killed a healthy `code_task` for
taking a while. Renders bracket every tool call, so the value to pick is the
widest gap _between_ renders, not the longest turn.

Expiry is announced, never silent: the sweep publishes a terminal render so the
thread says what happened. Redis expiry alone would make a turn vanish
mid-conversation, which is why `wack:expire-admission` cannot be deleted.

**Known gap:** a delegated turn is silent for as long as its subagent runs, so
`code_task` can exceed 30 minutes and be reclaimed mid-flight. A 2-hour lease
for delegated turns was tried and reverted — see _What to build next_.

## Rendering

The agent publishes **intent** (desired state); the bot maintains **projection**
(what is painted). The bot never invents content, the agent never touches
Discord.

Three traps, all of which shipped as bugs:

**Nonce.** Every posted message carries `enforce_nonce: true` so a retry is
idempotent. The nonce must therefore be stable per _thing_ and distinct
_between_ things. One per-turn nonce meant a turn's second input request was
deduped by Discord, which returned the first message unchanged while the
projection recorded the new content's hash — after which every render
short-circuited on the hash match and the approval was invisible forever.
Request nonces now derive from the request id.

**`appliedRevision` is recorded outside the renderer that did the writing.** It
can advance past a write that did not happen. Treat a projection claiming a
revision as evidence, not proof.

**Edits never notify.** Discord sends no notification for an edit, so anything
that must ping somebody has to be a _new message_ with explicit
`allowed_mentions`. Input requests get their own message for this reason.

Answered requests are settled in place — prompt kept, controls removed, outcome
appended — and retired requests are left in the channel as a record rather than
deleted.

## Steering

Eve has **no non-destructive interrupt**. `Session` exposes `cancel`, `clear`,
`compact`, `reset`, `respond`, `send`, and nothing pauses a turn. Eve's own TUI
defines steering the same way: _pop the oldest queued message and steer with it;
with nothing queued, cancel the turn._

So a correction cancels the running turn, and cancellation is lossy — durable
history "keeps only what had already settled". A turn cancelled seconds in takes
its request with it, which is why the agent once answered a correction by asking
what was wanted.

The flow now:

1. Ingress asks the queue whether a live turn holds the conversation —
   **before** enqueueing, because that answer decides the content. Asking after
   the claim finds the turn _this_ message just started and cancels it.
2. Both utterances are enqueued as **one message**. The bot holds both, so it
   composes them rather than stashing one for the agent to reassemble. This is
   what Eve's TUI means by coalescing.
3. The agent cancels the running turn.
4. `turn.cancelled` settles the delivery. **Nothing else will** — `session.completed`
   does not follow a cancellation, and without this the queue release never
   happens and the steering message itself is never claimed.

A turn cancelled before it said anything settles with no body; its anchor is
removed rather than left showing a bare reference id.

**Window worth knowing:** during the admission handshake `holder()` returns
nothing, so a steer arriving then is a no-op and the message simply queues.

## Subagents, and what to build next

A declared subagent (`code`) gets its own session and sandbox. The parent's
stream carries only `subagent.called` and `subagent.completed` — the bookends.
`subagent.event` does forward a child's stream events, but **only for inline
subagents**, which `code` is not.

Reading child progress means subscribing to
`GET /eve/v1/session/:childSessionId/stream`. **The parent cannot: it is
suspended for precisely that span.** That single constraint decides the design.

### The relay

Build it in the bot, which already holds a socket and already renders:

1. Agent handles `subagent.called` and publishes `childSessionId`. Today we
   handle **no** subagent events at all — this is the starting point.
2. Bot subscribes to the child's stream.
3. Child progress becomes the activity line.

The third step is why this is the right fix rather than a bigger timeout: each
render refreshes the lease, so the delegated-turn gap **disappears** instead of
being special-cased. It also delivers the subagent status updates the channel
has always been missing.

Two things to design deliberately: the intent/projection split means the bot
must not invent render content, so decide whether progress rides as an
agent-published intent or as a distinct bot-owned line; and the child stream
must be torn down on `subagent.completed`, on turn cancellation, and on bot
shutdown.

## Gates

```bash
bun run format
bunx oxlint --deny-warnings
bunx tsc --noEmit -p packages/{shared,bot,agents}/tsconfig.json
bun run --filter @repo/agents check:capabilities
bun run --filter @repo/agents check:serialization
bun run --filter @repo/shared check:invariants   # ← this directory
bun run build
```

`check:invariants` is the one that matters here. It drives a delivery through
the real Lua, asserts five properties after every transition, then cuts the
sequence short at each step and asks whether the state that remains is bounded.
None of those are type-level properties, so `tsc` and lint were never going to
see them — which is why every defect in this layer reached production.

It does **not** yet model `turn.cancelled`, because cancellation is an
agent-side event rather than a Lua transition. The steering path is exactly what
it should cover and does not. Extending it is worth doing before the next change
to steering.

Two lessons that cost real time, recorded so they cost less next time: a checker
that cannot fail is worth nothing — the first version of this one hardcoded a
`dispatchId` that `enqueue` mints itself, so every script answered `stale` and
the whole trace passed while doing nothing. And a fixture that fails schema
validation reads exactly like a broken system. In both cases the tell was a
transition that never moved the phase.
