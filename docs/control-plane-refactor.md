# Refactoring the Redis control plane

Written 2026-08-12, after a night in which five production defects were found
and every one of them was in this layer.

## The short version

The pending queue stays. Vercel Queue cannot replace it, and Eve's own
documentation instructs channel authors to build it. What should go is the
**four-phase admission state machine** — a second turn-lifecycle tracker running
alongside Eve's, kept in sync by hand, with no expiry on its key.

Outcome: **the script count did not move, and should not have.** The wedges were
never caused by the number of Lua scripts — they were caused by a key that could
not expire. That is fixed, every phase a record can be in is now bounded, and
the deletion this plan opened with turned out to be the wrong thing to do. The
reasoning is kept below rather than rewritten, because the disproved version is
the useful part.

## What is here today

| File                    |     Lines | Lua scripts |
| ----------------------- | --------: | ----------: |
| `queue.ts`              |       645 |           9 |
| `render.ts`             |       321 |           6 |
| `interaction.ts`        |       184 |           1 |
| `admission.ts`          |       169 |           3 |
| `render-publication.ts` |       158 |           2 |
| **total**               | **1,940** |      **21** |

Plus 22 key builders in `keys.ts`.

The concentration of defects is the argument for touching any of it. Of the five
bugs found on 2026-08-11, all five were in this layer or the renderer that reads
its projection; none were in the agent, the tools, the model, or the 670-tool
subagent tree.

| Defect                                                             | Site              |
| ------------------------------------------------------------------ | ----------------- |
| Second input request of a turn never rendered (nonce collision)    | render projection |
| `appliedRevision` advanced past a write that never happened        | render projection |
| `claim` refuses any non-`claimed` record; key has no TTL           | admission fence   |
| Steering unreachable — it sat behind the claim it needed to bypass | admission fence   |
| Steering cancelled the turn it had just started                    | admission fence   |

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

The 15-minute hard cap added that night was worse than a band-aid: it measured
from when the delivery was claimed, so it would have killed a healthy
`code_task` at fifteen minutes for the crime of taking a while. Phase 1 replaced
it with a lease measured in silence rather than elapsed time.

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

- `admission.ts` — `wack:start-delivery`, `wack:confirm-delivery`,
  `wack:finish-admission`. Most of the handshake collapses into "claim writes the
  lease; renders refresh it", but **not all of it**: something must still mark
  the delivery as taken by the agent, because `wack:publish-render` refuses to
  publish against a record that is not `live`. That becomes one small
  `wack:mark-live` rather than a three-way handshake with its own lease key.
- `wack:recover-admission`. Its trigger — a record `live` with no session id and
  no ingress owner — is a delivery that went silent, which the lease now covers.

**Corrected from the first draft of this plan: 21 scripts → 18, not 13.**
Implementing Phase 1 showed two of its claims were wrong. `wack:confirm` cannot
go — the session id is not known at claim time, it comes back from Eve
afterwards, and steering needs it. And `wack:expire-admission` must stay, because
Redis key expiry is silent: something has to notice and tell the thread, or a
turn simply vanishes mid-conversation.

### One correction to "parking deletes it"

Rule 3 above is wrong as written and was implemented differently. Parking cannot
delete the record — the parked turn still owns the conversation, and `complete`
fences on the record still being there. Parking instead hands over to a longer
lease (24h), which keeps the property that matters: bounded, not immortal.

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

### Phase 1 — the lease itself ✅ shipped `73643a1`

The absolute cap became a refreshed lease; `agent:active` gained a real `PX`
expiry; every rewrite of the record carries `KEEPTTL`; parking hands over to a
24h lease. `admission.ts` is untouched — deleting it is Phase 2, and separating
the two is what makes each reversible.

Phase 0 was skipped deliberately. Its purpose was to check the lease agrees with
the phase machine on live traffic over a day, but the lease is refreshed by an
event we can drive directly, so the same question is answerable in seconds
against real Redis instead of a day of watching.

_Verified_ against production Redis, four scenarios:

| Scenario                   | Expected                         | Result |
| -------------------------- | -------------------------------- | ------ |
| Turn publishes a render    | lease → +30min, not reclaimed    | ✅     |
| Turn silent past its lease | reclaimed, record cleared        | ✅     |
| `claim`                    | stamps 48h key TTL + 30min lease | ✅     |
| `confirm`                  | leaves the key TTL intact        | ✅     |

The last one is the trap: a bare `SET` clears a Redis TTL, so `confirm` alone
would have restored the immortal key on the first follow-up of every
conversation — reintroducing the exact bug being fixed, silently.

### Phase 2 — abandoned, and why

**Do not delete `admission.ts`.** Attempting it showed the plan's premise was
wrong, and the finding is worth more than the deletion would have been.

The premise was that the admission machinery caused the defects. Re-reading the
five with the code open, none of them did:

| Defect                                | Actual cause                          |
| ------------------------------------- | ------------------------------------- |
| `claim` refuses non-`claimed`; no TTL | the missing expiry — fixed in Phase 1 |
| Steering unreachable behind the claim | where `steerActiveTurn` was called    |
| Steering cancelled its own turn       | argument ordering in `submitMessage`  |
| Nonce collision                       | the renderer, not this layer          |
| `appliedRevision` past a failed write | the renderer, not this layer          |

Zero were caused by the handshake existing. They were caused by a key that could
not expire, which is now fixed, and by two call-site mistakes.

Deleting it would also have broken two things the plan did not account for:

- **`ingressKey` is not admission's.** The interaction route takes the same lease
  (keyed by `interactionId`), and `resetCutoverStatus` reads it to decide whether
  a reset is safe to start. Removing it from deliveries would silently report
  "ready" while a delivery was mid-flight into Eve.
- **`recover-admission` and `expire-admission` are complementary tiers, not
  duplicates.** Recovery is the fast path for "the agent POST died before
  acknowledging" and deliberately wedges with a _reset before retrying_ notice,
  because it cannot tell whether Eve started the turn. Expiry is the slow
  backstop that frees the conversation. Collapsing them would trade a
  seconds-scale response for a 30-minute one.

### Phase 2, as actually shipped — close the last immortal state

One line, and the only thing Phase 2 was really owed. `expire-admission` skipped
`recovery-required` records, so a deliberate safe wedge held its conversation
forever and needed a human to react ✅ to release it. Holding it _pending_ was
the intent; holding it _forever_ was not.

With that included, every phase a record can be in is now bounded.

_Verified_ against Redis, two further scenarios on top of Phase 1's four: a
`recovery-required` record past its lease is reclaimed and cleared, and a parked
turn with 23 hours left on its lease is left strictly alone.

### Phase 3 — optional: Vercel Queue for wakeups

Replace the best-effort HTTP callback and the sweep's polling with
`@vercel/queue`, using `delaySeconds` for backoff and `idempotencyKey` on the
dispatch id. The pending list stays exactly where it is; only the "there is work
to do" signal moves.

_Verification:_ kill the bot mid-turn and confirm the conversation still
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
