# The conversation control plane

How a Discord message becomes a turn, what holds a conversation while it runs,
and what to build next. Written 2026-08-12 after a night in which nine defects
were found and fixed here; every fact below was verified against production
rather than read off the source. Revised 2026-08-13, when the layer was rewritten
from the ground up — see [the rewrite](#the-rewrite) for what moved and why.

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
delivery:enqueue          pending:<key> ← message      (agent:seen dedupes)
delivery:claim            agent:active ← phase=claimed PX 48h, turn lease +30m
delivery:mark-live        phase → live                 ingress lease taken
delivery:confirm-session  sessionId ← wrun_…
render:publish            intent ← revision N          turn lease refreshed +30m
render:settle-and-park    phase → parked               lease → 24h, parked marker
render:complete           render-outcome ← "applied"
delivery:complete         agent:active deleted         index entry released
```

Every step is fenced. `dispatchId` and `messageId` must match, phases must be
legal, and a stale replay is refused rather than applied — Eve reports
`stepIndex: 0` _and_ `sequence: 0` for every step of a turn that suspends and
resumes, so neither can ever be used as a replay cursor.

## The rewrite

The layer described below was rebuilt on 2026-08-13. What it replaced is recorded
here because the shape of the old problem is what the new one is built to prevent.

The measurements that justified it: 29 Lua scripts, 22 key builders plus 11 keys
built inline _inside_ Lua, 12 persisted state strings across 6 machines, **5
separate claim-token protocols**, 26 TTL constants (two declared twice with a
comment asking that they stay in step), and 23 commits in 30 days of which 11 were
fixes or reverts. Nine defects in one night, every one invisible to `tsc` and lint,
because the invariants are not type-level.

The recurring shape was **one record, many writers, no owner**.

What replaced it:

- **One lease.** `claimToken`, `ownerToken`, `admissionAttemptId`, `resetId` and
  `receiptIdentity` were five spellings of "somebody holds this until some time".
  `lease.ts` has one, with one set of durations and one Lua fence.
- **One reader and one writer per record**, in `readers/` and `writers/`. A writer
  exposes one method per transition, named for the transition, with no `set` or
  `update` escape hatch — so the set of things that can happen to a record is the
  set of methods on its class.
- **Two declarative machines** in `machines/`, driven in lockstep with the real
  Lua by `check:invariants`. Redis stays authoritative: transitions execute inside
  Lua next to the compare-and-set that makes them atomic, and moving a guard out to
  JavaScript would turn check-then-write into a race across two processes. The
  machines say which transitions are _legal_; the gate fails if the two disagree.

## Redis, and the one record that matters

`agent:active:<conversation>` is the record that says a turn holds this
conversation. It used to be mutated by eleven Lua scripts across three files under
six different predicates, which is the shape behind most defects found here: to
change it safely you had to know all eleven, so a file-scoped audit was
structurally guaranteed to miss some.

It now has one writer — `DeliveryWriter` — plus exactly two methods on
`RenderWriter` that touch it, `publish` and `settleAndPark`. Those two are
deliberate rather than a layering slip: publishing a render is the only signal
frequent enough to prove a turn is alive, and parking is one transition that both
ends the turn and fixes the final frame. Split across two round trips, either
could half-happen.

Two mitigations, both load-bearing:

**One owner for the write.** `DELIVERY_RECORD_LUA` in `records/delivery.ts`
defines `writeRecord` beside the schema that says what the record may look like,
and every script that rewrites it calls that. A new invariant is added once.

**`KEEPTTL` on every write.** A bare `SET` clears a Redis expiry. This was
forgotten three times in one night — including in `wack:start-delivery`, which ran
on _every_ delivery and silently made the key immortal again moments after `claim`
had bounded it. If you add a write, use `writeRecord`.

Invariants that live _inside_ the JSON survive automatically; every script
round-trips unknown fields through `cjson`. Invariants that live _outside_ it —
the key's expiry, index membership — must be re-asserted by every writer, and
nothing but the checker enforces that. **That distinction is the single most
useful thing to know before editing this directory.**

## Nothing is allowed to live forever

Every wedge found here reduced to a record that could not expire. The rule now
is that no state is unbounded:

| State                     | Bound  | Refreshed by                                     |
| ------------------------- | ------ | ------------------------------------------------ |
| A running turn            | 30 min | every published render, every child stream event |
| A turn parked on a person | 24 h   | —                                                |
| The delivery record       | 48 h   | —                                                |
| The parked marker         | 48 h   | —                                                |
| Every render key          | 7 d    | —                                                |
| A superseded/stuck record | swept  | `delivery:expire`                                |

The running-turn lease is measured in **silence, not elapsed time**. An earlier
version capped from the claim, which would have killed a healthy `code_task` for
taking a while. Renders bracket every tool call, so the value to pick is the
widest gap _between_ renders, not the longest turn.

Expiry is announced, never silent: the sweep publishes a terminal render so the
thread says what happened. Redis expiry alone would make a turn vanish
mid-conversation, which is why `delivery:expire` cannot be deleted.

**Two leaks found by auditing this rule against the live store, 2026-08-13.** Both
were bare `SET`s that nothing else bounded:

- `delivery:enqueue` wrote `agent:render-target:<dispatch>` with no expiry. The
  target only ever gained one from a _terminal_ paint, so every delivery that
  ended any other way left a key nothing would collect. **63 such keys existed.**
- `render:settle-and-park` wrote the parked marker with no expiry. A marker
  outliving its delivery record is invariant I5: `complete` can never fence
  against it again, so it is unusable _and_ uncollectable.

Both are fixed, both are now asserted by `check:delivery` and `check:render`, and
the 63 existing keys were given an expiry by hand. The lesson generalises: grep
the writers for `redis.call("SET"` without `EX`, `PX`, `NX` or `KEEPTTL` — that
is the whole audit, and it takes one command.

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

### The relay — built

1. **Address** (`4d6295a`) — `agent/hooks/subagent.ts` writes
   `agent:subagent:<dispatchId>` on `subagent.called`, clears it on
   `subagent.completed`. A hook, not a channel handler: `ChannelEvents` does not
   carry the subagent events at all; only `HookEventMap` does.
2. **Auth** (`00f0bcc`) — the same hook mints a Vercel OIDC token, because it
   runs inside a function and the bot has no Vercel identity of its own. Twelve
   hours against a minutes-to-hours delegation, so one mint serves the whole
   thing and there is no refresh path. Verified: that token opens the child
   stream with a 200.
3. **Follower** — the bot reads the child's stream. Each recognised line does both
   jobs: it becomes the progress under the turn's status line, and it refreshes
   the lease. `delivery.refreshTurn` is fenced on the delivery so a follower from
   a turn that moved on cannot hold the next one.

The delegated-turn gap is closed by construction rather than by a longer timer,
which is why the two-hour lease was reverted rather than kept.

Ownership stayed put: the intent is the agent's alone, and the child's progress
is bot-authored in the projection, merged by the renderer.

### Two things the follower got wrong, and how they hid

Both produced silence, which is indistinguishable from "nothing is happening".

**It parsed the stream as SSE.** Every line was filtered for a `data:` prefix, but
eve's stream is **NDJSON** (`application/x-ndjson`). Every line was discarded, so
the follower emitted no progress and refreshed no lease — the two things it exists
to do — while looking perfectly healthy. Three conclusions were drawn from that
silence and all three were wrong: the stream was assumed empty, the session idle,
and replay unsupported. With correct parsing the same stream returns 42 events and
replays from `startIndex=0`.

**It followed the parent, not the child.** The section above already said the
parent carries only the bookends; the code did not do what the section said. Even
with correct parsing it would have seen two events for an entire delegation —
enough to narrate a start and a finish, nowhere near enough to keep a 30-minute
lease alive across work that runs longer than that.

Both are fixed by handing the wire format to `eve/client`, which also brings
cursor and reconnect handling the hand-rolled reader had no version of. The parent
is followed for its boundaries; each `subagent.called` names a `childSessionId`,
and each child is followed for its work.

Typed events paid for themselves immediately. `actions.requested` carries a
discriminated union of four action kinds — `tool-call`, `subagent-call`,
`remote-agent-call`, `load-skill` — where the hand-written schema knew two optional
string fields and silently rendered nothing for the rest.

**Still not exercised end to end.** The client reaching the real agent is verified
(`health()` returns ready; a stream attach returns a clean 401 for an expired
token, so host, route, transport and auth wiring are correct). A live delegation
narrating needs a real `code_task` in Discord — watch for a `↳ code: …` line under
the status line, and for the turn surviving past thirty minutes.

## Testing the agent without Discord

`eve invoke` drives a deployed agent over HTTP with no terminal:

```bash
bunx eve invoke -u https://eve.purduehackers.com --scope purdue-hackers "…"
```

Safe against production by construction: an HTTP-created session holds the
stable ID alias and **no channel continuation token**, so it cannot write to
Discord. It is a real session and costs real tokens; it just has no channel.

### The missing half: a principal

An HTTP session has no principal, so `roleFromMemberRoles` sees nothing,
`decideCodeCapability` denies, and every interesting path — `code_task`,
anything admin-gated, the whole subagent relay — is refused before it starts.
Which makes the loop useless for exactly the things worth testing.

What is needed is a way to say _invoke as this Discord user_:

```bash
DISCORD_IMPERSONATE_USER_ID=636701123620634653 bunx eve invoke -u … "run a code task"
```

The seam is `authFor` in `agent/channels/discord.ts`. It builds a
`SessionAuthContext` from a `Principal` — `userId`, `username`, `nickname`,
`memberRoles` — and `memberRoles` is the only field that matters, because
`roleFromMemberRoles` derives the tier from it and every policy decision reads
that. So the work is: resolve the member from `DISCORD_GUILD_ID` over Discord
REST, build the principal from the real roles, and assert it for sessions that
arrive without one.

Fetching the roles rather than accepting them from env is deliberate. Roles
passed in would be a way to mint an admin that does not exist; roles read from
the guild can only ever impersonate someone who already has the access.

### Running it

`eve invoke` with no `-u` builds and runs the agent locally, where `VERCEL_ENV`
is unset and impersonation is therefore allowed:

```bash
cd packages/agents
set -a; . ../../.env.local; set +a
DISCORD_IMPERSONATE_USER_ID=636701123620634653 \
  bunx eve invoke "use the code subagent to inspect purduehackers/wack-hacker"
```

Proven to work end to end. The assertion lands —

```json
{
  "event": "discord.impersonated",
  "userId": "636701123620634653",
  "username": "chryzm1111",
  "roles": 19
}
```

— and an admin-gated `code_task` reaches its approval instead of a policy
denial, having spawned a real child session:

```
agent "agents" -> wrun_01KZVGMNXYP199N63N4BWBJGP2
agent "code"   -> wrun_01KZVGMVDZ59YR2015WE49PFQZ
status: input-required, kind: tool-approval
```

**What this loop cannot reach.** An impersonated session has no Discord dispatch,
so `subagent.called` finds no `discordDispatchId`, writes no delegation, and the
follower never starts. That is correct — there is nowhere to paint — but it
means the relay's rendering half is still only exercised by a real Discord turn.
This loop proves the delegation path and the policy tier; the `↳ code: …` line
needs the channel.

Deploying a preview for the fuller path is currently blocked on project
configuration: the project's root directory is `packages/agents`, and
`vercel deploy` fails from both the repo root and that directory. The git
integration only builds the production branch, so a branch push produces no
preview either.

### The gate this needs

**It must be impossible in production.** Anything that lets an environment
variable choose a principal is privilege escalation if it survives the deploy
that matters. Gate it on the eve environment being development, and fail loudly
rather than silently falling back to an unprivileged session — a test that
quietly runs as nobody is worse than one that refuses to run.

## Gates

```bash
bun run format
bunx oxlint --deny-warnings
bunx tsc --noEmit -p packages/{shared,bot,agents}/tsconfig.json
bun run --filter @repo/agents check:capabilities
bun run --filter @repo/agents check:serialization
bun run --filter @repo/shared check:invariants   # ← this directory
bun run --filter @repo/shared check:delivery
bun run --filter @repo/shared check:render
bun run build
```

The three Redis-driven checks are the ones that matter here, and each found a real
defect the day it was written.

`check:invariants` drives a delivery through the real Lua, asserts five properties
after every transition, then cuts the sequence short at each step and asks whether
the state that remains is bounded. It also drives both declarative machines in
lockstep and fails if a phase disagrees with what Redis actually holds. That
lockstep is not decorative: deleting `PARK` from the delivery machine makes it fail
with `M1 Redis performed PARK, which the machine refuses from live`, which is how
it was checked.

`check:delivery` and `check:render` cover the transitions themselves — 36 and 40
assertions against real Redis. None of these are type-level properties, so `tsc`
and lint were never going to see them, which is why every defect in this layer
reached production.

`check:invariants` does **not** yet model `turn.cancelled`, because cancellation is
an agent-side event rather than a Lua transition. The steering path is exactly what
it should cover and does not. Extending it is worth doing before the next change to
steering.

**They race with a bot running older code.** The probe advertises itself in the
global queue index — it has to, since half of what it asserts is about that index —
so any process still running a previous deploy will sweep the probe conversation up
and win the claim. It shows as an inscrutable "the active record carries no lease",
and the gate names the likely cause when it sees a record shape the current writer
cannot produce. Re-run after deploying.

Two lessons that cost real time, recorded so they cost less next time: a checker
that cannot fail is worth nothing — the first version of this one hardcoded a
`dispatchId` that `enqueue` mints itself, so every script answered `stale` and
the whole trace passed while doing nothing. And a fixture that fails schema
validation reads exactly like a broken system. In both cases the tell was a
transition that never moved the phase.
