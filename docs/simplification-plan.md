# Simplification implementation record

> Status: Groups A–E are approved, implemented, and locally validated on the
> final reviewed branch. The hosted Eve `defaultBackend()` reattachment check
> remains a deployment cutover canary, not a code blocker.

## Audit baseline and measured result

The initial audit at `2cec01c` covered **421 tracked TypeScript files, 52,853
lines, and 168 passing tests**. These values are retained as the baseline rather
than being rewritten to match later work.

### Initial evidence

The following table records what the initial audit found at `2cec01c`; it is not
a description of the integrated implementation.

| Area                   | Initial evidence at `2cec01c`                                                                                                                                                                              | Initial finding                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Skills                 | 115 `SKILL.md` sources (3,381 lines), 11 generated registries (2,436 TypeScript lines), 11 custom skill runtimes (1,033 lines), 11 custom catalogs (1,115 lines), and 276 lines of compiler/formatter code | Wack Hacker rebuilt Eve's skill discovery, `load_skill`, activation state, and history tracking                                       |
| Domain tool policy     | 11 `lib/runtime.ts` files totaled 2,773 lines and were 79–98% structurally similar                                                                                                                         | Authorization, approval, audit, and execution policy were copied instead of shared once                                               |
| Discord commands       | `handler.ts` was 1,234 lines; `record()` was called about 44 times, `records()` 18 times, and `compact()` 20 times                                                                                         | A loose `Record<string, unknown>` layer discarded discord.js's exported contracts and turned malformed responses into partial success |
| Conversation lifecycle | Queue, admission, render, HITL, authorization, reset, and scheduled-fire Lua were owned by both runtimes across at least eight files                                                                       | One persisted aggregate had multiple private key builders, implicit record shapes, and transition owners                              |
| Tests                  | Production delivery/render Lua was imitated by fakes; `renderer.ts` and the 872-line Eve Discord channel had no end-to-end lifecycle characterization                                                      | The green suite could not safely prove a state-machine consolidation                                                                  |
| Manual types           | Several local interfaces exactly restated Eve, Sentry, fetch, Upstash, Drizzle, and Zod-derived types                                                                                                      | Small, mechanical drift risks remained after the large architectural duplication                                                      |

The size of a file was not treated as evidence that it should be split. The
shell policy, renderer checkpoints, schedule leases, supervisor fencing, and
strict JSON guard are branch-heavy because they encode real safety or durability
rules. They remain unless characterization proves a smaller equivalent.

### Current measurements

At the final security review, `git ls-files '*.ts' '*.tsx'` contains **427
tracked TypeScript files and 52,996 lines**. Direct package test runs pass **271
tests**:

| Package    | Passing tests |
| ---------- | ------------: |
| agents     |           157 |
| bot        |            52 |
| shared     |            53 |
| supervisor |             9 |
| **Total**  |       **271** |

The real-Redis contract suite separately remains at **10 tests / 64 assertions**
against production Lua. The package totals above come from each package's Bun
`test` script on the integrated branch; they are not inferred from old totals.

For a production-only comparison, count tracked `.ts`/`.tsx` blobs under
`packages/`, excluding `*.test.*`, `*.spec.*`, test directories, and `scripts/`.
That measure fell from **47,351 lines at `2cec01c` to 43,999 lines at final
review**: a measured reduction of **3,352 production TypeScript lines (7.1%)**. Group A
also deleted **3,381 lines of duplicate skill Markdown** from
`packages/agents/skill-sources/`.

The initial 6,000–8,000 production-TypeScript estimate was not met and is not a
current claim. Tests and contract schemas grew, leaving repository-wide tracked
TypeScript almost flat while production TypeScript became smaller. The measured
result, plus removal of the duplicate Markdown skill system, is the honest size
outcome; the ownership and fail-closed improvements are the larger architectural
result.

## Security and durability invariants

The implementation preserves these review constraints:

1. The bot is the only Discord gateway and REST principal. Eve produces semantic
   desired state; it never materializes Discord messages.
2. One active dispatch exists per continuation key. Pending turns are FIFO and
   survive process restarts.
3. A possibly accepted Eve admission is never replayed. Expired ambiguous work
   becomes `recovery-required` exactly once and remains visibly resettable.
4. A terminal render outcome (`applied` or deliberately `discarded`) is the
   commit barrier before the next turn.
5. Render revisions are monotonic and content-stable. Lease, dispatch, session,
   turn, reset, and revision fences continue to reject stale work.
6. Reset atomically partitions pre-cutover from post-cutover work and purges the
   old render/HITL/authorization state.
7. HITL components remain opaque locators. Current Discord roles, requester
   authority, second-party approval, first-winner claims, and receipts remain
   authoritative.
8. Skill instructions never grant execution authority. Tool visibility,
   approval, and execution revalidation are independent.
9. Existing wire route names, Redis keys/TTLs, Discord custom IDs, scheduled
   occurrence IDs, and applied SQL migrations remain compatible.
10. Eve tool/state outputs remain strict plain JSON. The existing guard against
    class instances, cycles, accessors, `Result`, `Date`, nonfinite numbers,
    `-0`, sparse arrays, and unsafe properties is not replaced by `z.json()`.

## Current data flow

`docs/architecture.md` is the current diagram. The important dependency rule is:

```text
Discord adapters -> bot ConversationFlow -> shared ConversationStore -> Redis
                                      |                  ^
                                      v                  |
                             Eve Discord channel --------+
```

The bot owns the single reconciler. The bot and Eve channel use the same store
API because both participate in admission and desired-state publication. HTTP
callbacks only wake the reconciler. Redis keys, persisted schemas, and Lua
scripts are not reimplemented by either runtime.

## Implementation record

### Phase 0 — behavioral proof before deletion

Phase 0 added characterization rather than changing architecture. Tests live
beside the owning code and move with it rather than forming another workspace.
The real-Redis suite runs the production Upstash client and Lua through pinned
Redis 6.2 and `serverless-redis-http` containers. It covers queue dedupe, FIFO,
lease takeover, independent keys, reset cutover, lost-response admission,
ambiguous-admission recovery publication, one-winner HITL, interaction-receipt
duplicate and conflict fencing, reset staleness, lost render callbacks, render
claim/renew/release/discard, authorization indexing, scheduled-fire
claim/complete/release, and a two-turn streaming/terminal/restart flow with a
stateful Discord fake.

All 27 production conversation Lua scripts execute in that suite. The restart
case proves queue completion stays pending until the terminal outcome exists.
The capability artifact freezes each skill's policy role, description, criteria,
tool membership, and normalized instruction digest. A table-driven policy test
covers anonymous, public, organizer, and admin discovery and loading across all
11 domains, including exact `Unauthenticated`, `Forbidden`, and `NotFound`
precedence. Discord fixtures pin channel projection and writes, managed-guild
confinement, webhook credential omission, typed rate-limit mapping, malformed
response failure, and exact operation parity.

The initial golden run exposed a real coordinator lifetime bug:
`applyLatest` returned a pending traced promise from inside `try/finally`, so the
render lease was released before its checkpoint. Awaiting the traced operation
inside the lease scope restored the stated behavior. This was a narrow
correctness repair supported by the characterization, not an architecture
change.

### Group A — Eve-native skills — implemented

Each integration subagent now owns a `skills/catalog.ts` that directly exports
Eve `defineDynamic` from `eve/skills`. Its `turn.started` resolver returns the
role-permitted map of `defineSkill` values. Eve advertises the skills, owns
`load_skill`, and supplies loaded-turn context. A separate `step.started` tool
resolver derives visibility from current role and descriptor policy; it never
reads model history or `load_skill` output. Approval and execution revalidation
remain independent, and missing provider configuration remains a typed
execution-time failure.

The implementation deleted:

- `packages/agents/skill-sources/**` — 3,381 duplicate Markdown lines
- the skill manifest compiler and formatter scripts
- all 11 generated skill registries and custom skill runtimes
- custom `load_skill` tools, activation strings, loaded-skill history parsing,
  and duplicate catalog resolvers
- compile/format hooks that existed only for the generated tree

The normalized feature artifact remains equal across 11 domains, 104 skills,
659 tools, and 13 subagents, including the code and docs auxiliaries. Root skill
documents were reviewed against subagent instructions before the duplicate copy
was removed.

A compiled Eve 0.29.5 canary has proven local `defaultBackend()` behavior with an
actual Linear skill: native `load_skill` returned the expected Markdown on two
turns of one preserved session, and a later resolver result of `{}` removed it.
Repository `eve info` and `eve build` report the expected skill and tool resolver
for every integration subagent. Hosted sandbox reattachment cannot be proven by
a repository test; it remains the deployment canary. Failure stops cutover and
does not justify restoring a parallel loader.

#### Accepted eval tradeoff

Group A intentionally trades the custom activation protocol for a larger
library-native tool catalog. A source-level JSON Schema estimate for an
organizer measured GitHub at 109 visible tools / 64,642 serialized bytes (old
base: 4 / 2,672; old largest base-plus-one-skill: 16 / 9,872) and Vercel at 166 /
60,471 bytes (old base: 8 / 3,966; old largest: 42 / 15,697). Provider
tokenization differs, but the direction is material. Approval accepted
policy-visible tools being present before `load_skill`, as Eve documents, in
exchange for deleting activation markers, history parsing, and the parallel
loader. If this prompt/tool-selection cost becomes unacceptable, the next step
is a separately approved native Eve connection or subagent partition, not a new
custom loader.

### Group B — conversation ownership — implemented

Group B changed ownership while preserving keys, values, TTLs, wire payloads,
component IDs, and terminal strings. Redis remains the durable coordination
boundary.

Implemented boundaries:

- Persisted shapes used only to construct Lua arguments remain local to their
  transition modules. `render.ts` keeps the real read-time Zod validation for
  stored render projections; unused aspirational schema exports were removed.
- `packages/shared/src/conversations/store.ts` is the only exported Redis-facing
  conversation API. Internal files separate Lua by aggregate, but callers see
  one `ConversationStore`.
- `packages/bot/src/conversations/flow.ts` is the only bot-side reconciler. It
  owns `submit`, `answer`, `reset`, `admitSchedule`, `wake`, `start`, `sweep`, and
  `stop`.
- Focused adapters remain in `agent/client.ts`, `agent/render/`,
  `agent/hitl/interaction.ts`, and `agent/scheduled.ts`; no pass-through
  `conversations/{discord,eve}.ts` wrappers were introduced.

Transition ownership moved out of the old bot queue/render/HITL stores and Eve
coordination/render/receipt implementations. Separate Eve admission confirmation
and bot queue acknowledgement remain because they fence different crash windows.
The production Lua bodies and `redis.eval` remain; replacing them with
`createScript`, pipelines, transactions, or normalized TTLs would be a separate
behavior-sensitive change.

`ConversationFlow` replaced `createAgentSeam`'s mutable `recoverParked` callback
cycle and the in-memory terminal waiter. Wakeups enqueue reconciliation and
return promptly. Reconciliation claims desired render state, materializes it,
records `applied|discarded`, and advances one queued turn. Queue-completion Lua
checks the terminal outcome rather than trusting caller ordering.

The Group B implementation moved or added 2,607 production TypeScript lines and
deleted 2,453 (net +154). The store intentionally retains branch-heavy
durability logic; this group's result is ownership centralization, not line-count
deletion.

### Group C — strict Discord command boundary — implemented

The approved implementation is deliberately narrower than the original manager
proposal. The bot passes a
`DiscordRest = Pick<Client["rest"], "delete" | "get" | "patch" | "post" | "put">`
to one readable, exhaustive switch. It uses discord.js `Routes` and exported v10
REST input/result types. Small `discordObject`/`discordArray` guards fail closed
at raw REST boundaries, while strict project-owned Zod schemas validate every
semantic output before it crosses processes. We intentionally did **not** adopt
discord.js managers or cache semantics: they do not cover all RPC endpoints and
would change freshness/identity behavior without making this boundary simpler.

`DISCORD_COMMAND_INPUT_SCHEMAS`, `DISCORD_COMMAND_OUTPUT_SCHEMAS`, and the agent's
`DISCORD_TOOLS` registry have exact **68-key parity**. The output registry
`satisfies Record<DiscordCommandOperation, z.ZodType>`, the tool registry is
mapped by the same operation union, and the executor ends with
`command satisfies never`. Requests use a strict generated discriminated union;
response envelopes are strict; the agent decodes both the envelope and the
operation-specific success data. Malformed lists, objects, nested projections,
or successful envelopes now become typed `UpstreamError`/502 failures instead
of `{}`, `[]`, or partial successes.

The implementation also fixed behavior exposed by strict fixtures:

- archived thread listing validates the parent, covers applicable public,
  private, and joined-private routes, follows each route's timestamp or
  snowflake cursor, rejects missing/nonadvancing cursors, caps pages, and
  deduplicates IDs
- sticker creation accepts PNG, APNG, GIF, and Lottie JSON with correct upload
  metadata while retaining the 512 KiB bound
- sticker edits preserve omitted versus explicit `null` descriptions
- role-position operations summarize Discord's position response rather than a
  stale pre-move role

Validation covers all 68 canonical inputs, strict extra-key rejection, REST
method/path/body/query projection, representative valid result families,
malformed upstream failures, JSON-safe output, envelope decoding, and exact
contract/tool/switch parity.

### Group D — shared domain policy runtime — implemented

All 11 integration domains now use shared agent-local policy modules:

- `domain-tools.ts` defines `DomainToolSpec`, access descriptors, registry/name/
  input/output relationships, and the shared authoring helper
- `domain-runtime.ts` owns visibility, approval, second-party authority,
  execution-time current-role recheck, provider readiness, error mapping, audit
  order, output projection, and strict serialization
- `stores.ts` owns lazy approval, budget, and audit stores
- `usage-hook.ts` and `domain-audit-hook.ts` share hook behavior while thin
  per-domain exports remain for Eve filesystem discovery
- `provider-redaction.ts` centralizes GitHub/Sentry/Vercel secret, error, audit,
  and output redaction

Per-domain `runtime.ts` files are now narrow adapter objects instead of copied
policy engines. The 11 descriptor modules and 11 per-domain `define-tool.ts`
identity wrappers were deleted. Provider clients, Zod inputs, managed budgets,
immutable audit rows, current-role enforcement, and provider-specific error
mapping remain explicit.

Every Eve tool catalog still calls `defineTool` **directly inside** its dynamic
resolver and supplies an inline `execute` function that delegates to the shared
runtime. This source shape is a native Eve constraint: hiding `defineTool` behind
a factory prevents Eve replay reconstruction. The compiled native-tool lifecycle
canary exercises two turns and protects that constraint.

Requested-action audit ownership remains singular. GitHub, Sentry, and Vercel
requested actions are redacted before persistence, matching their execution
audit/output/error treatment; the post-merge redaction regression was repaired
and characterized. Scheduled principals may execute only tools whose effective
confirmation is `none`; confirmation-requiring actions fail closed instead of
silently erasing self or second-party approval. Schedule creation and cancellation
also revalidate the current organizer role at execution after self approval.
Feature parity is exact at **11 native domains / 659 tools / 104 skills / 13
subagents**.

### Group E — approved mechanical cleanup — implemented

Group E was intentionally limited to mechanical changes that had direct owner or
runtime evidence:

- `AuthAttributes` and test attributes derive from
  `SessionAuthContext["attributes"]`
- `MetricSink` derives from
  `Pick<typeof Sentry.metrics, "count" | "distribution">`
- Linear issue relations derive from `z.output<typeof issueRelationSchema>` and
  shopping insert input derives from Drizzle's `$inferInsert`
- duplicate agent JSON value declarations now use the existing strict
  serialization owner
- bot commands use discord.js `SlashCommandBuilder` directly; `defineCommand`,
  `commandName`, `toRegistrationBody`, `defineSchedule`, and unused
  `observeWith` identity helpers were removed in favor of direct values with
  `satisfies`
- shared `healthReportSchema`/`readyHealthReportSchema` now serve the bot,
  supervisor, and release checks
- shared `activeBotGenerationSchema`, decoder, Redis reader, and constants now
  serve the supervisor, Eve bot-endpoint resolution, release/operations scripts,
  and `sandbox-admin.ts`
- selected schedule view and claim rows now pass through strict Zod schemas that
  reject extra columns, invalid enums/counters/role JSON, and inconsistent
  once/recurring nullability before normalization

The schedule change did not alter lease SQL, task semantics, or applied
migrations.

## Deliberately unchanged or deferred

These older ideas were not part of the approved mechanical Group E result:

- **`AgentFetch`:** the named injected alias in `packages/bot/src/agent/client.ts`
  remains. It already derives parameters and return type from
  `globalThis.fetch`; replacing the useful test seam with an exact type alias was
  not proven simpler.
- **`AsyncDisposableStack`:** the bot keeps its explicit reverse-order shutdown
  registry, signal grace period, error isolation, and idempotent drain. A
  disposal-stack rewrite did not prove those lifecycle policies more clearly.
- **Bun route table:** `framework/server.ts` keeps the injected `fetch` dispatcher.
  Static `routes` did not prove simpler with the current request-level tests and
  dynamic dependencies.
- **Migrations and lease SQL:** no migration was added, rewritten, or reordered.
  Raw libSQL conditional claims remain; Group E tightened only the row decoder.
- **Discord managers/cache:** Group C intentionally kept the narrow REST seam and
  did not introduce cache-dependent semantics.
- **Conversation Lua/Redis API:** Group B did not replace production scripts with
  `createScript`, transactions, or pipelines, and did not change keys or TTLs.
- **Better Result seam:** the project-owned import seam and `fromNullable` helper
  remain; a dependency churn across workspaces was not justified.
- **Official Eve OpenAPI/MCP connections:** these remain a separately approved
  evaluation because they must preserve role, budget, approval, redaction, and
  audit behavior.
- **Supervisor splitting:** the cohesive fenced cutover reconciler was not split
  merely to reduce file length.

These are not unfinished blockers for Groups A–E. They are either retained
because current code is clearer or reserved for a future evidence-backed,
separately approved change.

## Validation gates

The repository keeps the following gates for behavior-sensitive production
changes:

1. `bun run format:check`
2. `bun run typecheck`
3. `bun run lint`
4. `bun run test`, plus the real-Redis contract suite
5. `bun run build` and Eve `build`/`info`
6. unchanged reviewed capability names unless separately approved
7. `bun run audit`
8. fresh and repeated Drizzle migrations when database code changes
9. Linux/amd64 bot image build when runtime/package code changes
10. `git diff --check`

A diff gate must flag any changed wire schema, Redis key/TTL, custom component
ID, migration, tool/skill name, authorization rule, or terminal error string.
The current CI also runs the compiled native skill lifecycle, compiled inline
native tool lifecycle, production Redis/Lua contract suite, migration checks,
and bot image build.

After the final security review, direct Bun package tests pass 271/271 (agents
157, bot 52, shared 53, supervisor 9), the feature-parity checker reports
11/659/104/13, and the real-Redis suite reports 10 tests / 64 assertions. Hosted
Eve sandbox reattachment is the remaining **deployment canary**. It is checked
at cutover because local compilation cannot prove hosted sandbox persistence.

## Implementation and approval record

- **Phase 0:** implemented first to characterize the durability, policy, and
  Discord boundaries before deletion.
- **A — Eve-native skills:** approved and implemented. Approval accepted the
  model-visible tool timing/eval tradeoff without weakening execution authority.
- **B — conversation ownership:** approved and implemented with shared
  `ConversationStore` and bot-owned `ConversationFlow`.
- **C — Discord contract:** approved and implemented as the narrower
  `DiscordRest`/exhaustive-switch design with strict schemas; manager/cache
  semantics were deliberately not adopted.
- **D — domain runtime:** approved and implemented with shared policy runtime,
  stores, hooks, redaction, and direct inline Eve `defineTool` catalogs.
- **E — mechanical cleanup:** approved and implemented only for the derived
  owner types, helper removal, shared health/generation contracts, and strict
  schedule-row decoding recorded above.

There is no outstanding code approval request in this document. Future
state-machine, wire-contract, public-type, migration, or package-boundary changes
still require their own evidence and approval. The hosted Eve reattachment
canary remains an operational cutover decision, not an unimplemented code group.
