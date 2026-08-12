# Refactoring the Redis control plane

Written 2026-08-12, after a night in which five production defects were found
and every one of them was in this layer.

## The short version

The pending queue stays. Vercel Queue cannot replace it, and Eve's own
documentation instructs channel authors to build it. What should go is the
**four-phase admission state machine** — a second turn-lifecycle tracker running
alongside Eve's, kept in sync by hand, with no expiry on its key.

Target: **21 Lua scripts → 13**, `admission.ts` deleted, and the entire class of
"conversation wedged forever" bugs made unrepresentable rather than swept up
after the fact.

## What is here today

| File | Lines | Lua scripts |
| --- | ---: | ---: |
| `queue.ts` | 645 | 9 |
| `render.ts` | 321 | 6 |
| `interaction.ts` | 184 | 1 |
| `admission.ts` | 169 | 3 |
| `render-publication.ts` | 158 | 2 |
| **total** | **1,940** | **21** |

Plus 22 key builders in `keys.ts`.

The concentration of defects is the argument for touching any of it. Of the five
bugs found on 2026-08-11, all five were in this layer or the renderer that reads
its projection; none were in the agent, the tools, the model, or the 670-tool
subagent tree.

| Defect | Site |
| --- | --- |
| Second input request of a turn never rendered (nonce collision) | render projection |
| `appliedRevision` advanced past a write that never happened | render projection |
| `claim` refuses any non-`claimed` record; key has no TTL | admission fence |
| Steering unreachable — it sat behind the claim it needed to bypass | admission fence |
| Steering cancelled the turn it had just started | admission fence |

## What is genuinely required

Each of these is load-bearing, and three are required by Eve explicitly.

**A per-conversation ordered queue.** From
`eve/docs/concepts/execution-model-and-durability.mdx`:

> eve does not maintain a durable FIFO queue of user messages for a session. […]
> If your channel can receive bursts while the agent is working, keep your own
> per-session queue in the channel or app layer, then deliver the next message
> after the session parks again.

Ordering is not decorative here. "remind me tomorrow" followed by "and in three
months as well" produces the wrong reminder if it arrives reversed.

**Inbound deduplication.** From `eve/docs/channels/custom.mdx`: "Authenticate and
deduplicate command webhooks before…". Eve does not do it for us. `agent:seen`
is one `SADD` and earns its place.

**A gate on delivery.** The next queued message may only go in once the session
parks. Same doc, same paragraph.

**The render projection.** Discord message ids, content hashes, and which
request a message is asking about. Nothing outside this system can know it, and
edits must be idempotent across a bot restart mid-render.

## Verdict on the two SDKs

### `@vercel/queue` — no, not for this queue

Version 0.4.0 is real and installable. `SendOptions` offers `idempotencyKey`,
`delaySeconds`, `retentionSeconds`, and custom headers. What it does not offer
is **any ordering key** — no group id, no partition key, no FIFO grouping.
`consumerGroup` is Kafka-style fan-out, not per-key ordering.

Two hard mismatches:

1. **Ordering.** At-least-once delivery with no ordering key cannot express
   "these two messages belong to one conversation and must arrive in sequence".
2. **The gate.** Our drain is conditional on the session parking, which may be
   hours away while a human decides on an approval. Holding a queue message
   locked for that long is not a use these systems support.

A Redis list is, unglamorously, the correct primitive for an ordered
per-conversation buffer. It is also about 5% of the complexity in this
directory — `wack:enqueue` is nine lines.

**Where it does fit:** the wakeup path. Today the agent pokes the bot over HTTP
best-effort and a sweep polls as the durable backstop. That is precisely
at-least-once delivery with retry, and `delaySeconds` expresses the backoff
directly. Worth doing, but it is an optimisation, not the refactor.

### Workflow SDK — no, wrong side of the boundary

Eve is built on it (`workflow@4.8.2`). It is the agent-side durable runtime, and
the agent already gets its benefits. The bot is a long-lived gateway process in a
Vercel Sandbox holding a Discord WebSocket — not Fluid Compute, not a function.
The queue exists precisely because the bot must buffer while the agent-side
workflow is busy. Moving the buffer into the workflow removes the buffer.

## The actual root cause

`agent:active` is a phase machine — `claimed` → `live` → `parked` → deleted,
with a `recovery-required` branch — carrying eight fields, **and no TTL**.

Liveness is inferred from phase transitions that only some code paths perform.
`complete` deletes the record, but only when the turn reaches `parked`. A turn
that ends any other way leaves it behind, and `claim` then refuses every future
message on that conversation forever.

That is not one bug. It is a shape that produces a bug for every code path
someone forgets, and on 2026-08-11 all four production conversations were in
that state, the oldest for 21 hours.

The 15-minute hard cap added that night is a sweep that cleans up after the
shape rather than changing it. It should not survive this refactor.

## Target design

**Replace the phase machine with a lease that cannot outlive its own key.**

```
agent:active:<conversation>  = { deliveryId, sessionId, expiresAtMs }
                               SET … PX <lease>          ← a real Redis TTL
```

Three rules:

1. **Claim sets the lease** with a genuine `PX` expiry. No `phase`, no
   `ownerToken`, no `admissionAttemptId`, no second lease field.
2. **Observable liveness refreshes it.** Every render the agent publishes is
   proof the turn is alive, and renders already flow through Redis — the refresh
   is free, and no new heartbeat is invented.
3. **Parking or finishing deletes it.** A turn waiting on a human hands over to
   the parked marker, which is already durable and already has its own lifecycle.

A turn that dies stops refreshing, the key expires, the conversation frees
itself. Not because a sweep noticed, but because nothing kept it alive. The
wedge stops being a bug that gets fixed and becomes a state that cannot be
written down.

### What that deletes

- `admission.ts` entirely — `wack:start-delivery`, `wack:confirm-delivery`,
  `wack:finish-admission`. The three-way handshake collapses into "claim writes
  the lease; the first render refreshes it".
- `wack:recover-admission` and `wack:expire-admission` — both exist only to
  clean up after a lease that could not expire.
- `wack:confirm` — the session id is written by the claim's owner, not
  negotiated afterwards.

21 scripts → 13. `queue.ts` from 9 scripts to 4 (`enqueue`, `claim`, `complete`,
plus reset/purge). `keys.ts` loses `ingressKey` and `resetPendingKey`.

### What stays untouched

`render.ts` (6 scripts) and `render-publication.ts` (2). These are the
Discord-side idempotency and they are load-bearing: the projection is the only
record of which message is which. They deserve their own review — the nonce
collision and the `appliedRevision` bug both lived here — but that is a separate
piece of work with a separate risk profile.

`interaction.ts` (1 script) stays as is.

## Phases

Each phase ships on its own and is reversible. The gates are the ones CI runs:
`bun run format`, `bunx oxlint --deny-warnings`, `tsc` across the three
packages, `check:capabilities`, `check:serialization`, `bun run build`.

### Phase 0 — prove the lease in isolation

Add the TTL'd lease **alongside** the existing phase machine, written but not
read. Run for a day. Compare, on live traffic, every conversation where the
lease has expired against every conversation the phase machine still calls live.
They should agree; where they do not, the lease is wrong and this stops here.

*Verification:* a script that diffs the two views across all conversations,
run against production Redis. No behaviour change ships in this phase.

### Phase 1 — make the lease authoritative

`claim` reads the lease instead of the phase. `admission.ts` is deleted and the
agent's delivery route stops calling `startDelivery`/`confirmDelivery`. The
render publish path refreshes the lease.

*Verification:* the four expiry scenarios already exercised against real Redis
for the hard cap (legacy record past its lease with and without queued work,
fresh record inside its cap, explicit expiry) plus two new ones — a turn parked
on an approval must not expire, and a turn whose agent died must free the
conversation within one lease period.

*Risk:* highest of the four. This is the cutover. Roll back by reverting the
commit; the phase field is still being written through Phase 1 and is only
dropped in Phase 2.

### Phase 2 — drop the dead machinery

Remove `phase`, `ownerToken`, `admissionAttemptId`, `deliveryLeaseUntilMs`, the
hard-cap sweep, `recover-admission`, `expire-admission`, and the
`ADMISSION_RECOVERY_*` strings. Delete the now-unused key builders.

*Verification:* `grep` proves no reader remains. Existing records drain naturally
because Phase 1 no longer reads the fields.

### Phase 3 — optional: Vercel Queue for wakeups

Replace the best-effort HTTP callback and the sweep's polling with
`@vercel/queue`, using `delaySeconds` for backoff and `idempotencyKey` on the
dispatch id. The pending list stays exactly where it is; only the "there is work
to do" signal moves.

*Verification:* kill the bot mid-turn and confirm the conversation still
completes. Do not ship this before Phases 0–2 are settled — it changes the
recovery path, and the recovery path is what makes the cutover safe.

## What this does not fix

The renderer. Two of the five defects were in the render projection, and this
plan does not touch it. `writeHitl` has grown a message-identity concept, a
content hash, a nonce derivation, and a retirement path; `paint` records
`appliedRevision` from outside the renderer that did the writing. That
combination is what let a projection claim a write that never happened.

It deserves the same treatment — one owner for "what is painted" — and it should
be scoped separately, after the control plane settles.
