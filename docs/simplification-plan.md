# Simplification plan

> Status: Groups A (Eve-native skills) and B (conversation ownership) are
> approved, implemented, and locally validated. Hosted sandbox reattachment
> remains a Group A deployment cutover gate. Groups C–E remain proposed and
> unapproved; their wire-contract, public-type, abstraction, and package-boundary
> changes still require approval.

## Audit baseline

The original audit at `2cec01c` covered 421 tracked TypeScript files and 52,853
lines with 168 passing tests. After Groups A and B, the repository has 434
tracked TypeScript files and 54,680 lines; 187 tests pass (agents 120, bot 38,
shared 20, supervisor 9). The real-Redis suite separately runs 10 contract tests
with 64 assertions against production Lua.
The largest accidental systems and high-risk gaps are:

| Area                   | Current evidence                                                                                                                                                                                           | Finding                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Skills                 | 115 `SKILL.md` sources (3,381 lines), 11 generated registries (2,436 TypeScript lines), 11 custom skill runtimes (1,033 lines), 11 custom catalogs (1,115 lines), and 276 lines of compiler/formatter code | Wack Hacker rebuilds Eve's skill discovery, `load_skill`, activation state, and history tracking                                      |
| Domain tool policy     | 11 `lib/runtime.ts` files total 2,773 lines and are 79–98% structurally similar                                                                                                                            | Authorization, approval, audit, and execution policy are copied instead of shared once                                                |
| Discord commands       | `handler.ts` is 1,234 lines; `record()` is called about 44 times, `records()` 18 times, and `compact()` 20 times                                                                                           | A loose `Record<string, unknown>` layer discards discord.js's exported contracts and turns malformed responses into partial successes |
| Conversation lifecycle | Queue, admission, render, HITL, authorization, reset, and scheduled-fire Lua are owned by both runtimes across at least eight files                                                                        | One persisted aggregate has multiple private key builders, implicit record shapes, and transition owners                              |
| Tests                  | Production delivery/render Lua is imitated by fakes; `renderer.ts` and the 872-line Eve Discord channel have no end-to-end lifecycle characterization                                                      | The suite is green but cannot safely prove a state-machine consolidation                                                              |
| Manual types           | Several local interfaces exactly restate Eve, Sentry, fetch, Upstash, Drizzle, and Zod-derived types                                                                                                       | Small, mechanical drift risks remain after the large architectural duplication                                                        |

The size of a file is not itself evidence that it should be split. The shell
policy, renderer checkpoints, schedule leases, supervisor fencing, and strict
JSON guard are branch-heavy because they encode real safety or durability
rules. They remain unless a characterization test proves a smaller equivalent.

## Behavior that must not change

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
   occurrence IDs, and applied SQL migrations remain compatible during the
   first consolidation.
10. Eve tool/state outputs remain strict plain JSON. The existing guard against
    class instances, cycles, accessors, `Result`, `Date`, nonfinite numbers,
    `-0`, sparse arrays, and unsafe properties is not replaced by `z.json()`.

## Target data flow

`docs/architecture.md` is the target diagram. The important dependency rule is:

```text
Discord adapters -> bot ConversationFlow -> shared ConversationStore -> Redis
                                      |                  ^
                                      v                  |
                             Eve Discord channel --------+
```

The bot owns the single reconciler. The bot and Eve channel use the same store
API because both must participate in admission and desired-state publication.
HTTP callbacks only wake the reconciler. Redis keys, persisted schemas, and Lua
scripts are not reimplemented by either runtime.

## Refactor sequence

### 0. Add behavioral proof before deletion

This slice changes tests and test infrastructure, not production behavior.
Keep tests beside the owning code rather than creating another workspace.

**Add**

- Contract tests beside today's queue, coordination, render-store, and HITL
  modules that execute their public APIs and actual Lua through an
  Upstash-compatible local Redis HTTP emulator. Move these tests with the code
  when `ConversationStore` lands.
- `packages/bot/src/agent/conversation.contract.test.ts`: compose today's queue,
  router, coordinator, and a stateful fake Discord message store with
  edit/create/delete, enforced nonces, restart, and injected faults. Rename it
  with `ConversationFlow` later.
- Request-level tests for `packages/bot/src/framework/server.ts` and
  `packages/agents/agent/channels/discord.ts`.
- Focused contracts for native skills, Discord commands, HITL, schedules, and
  supervisor fencing as the relevant slice starts.

**Minimum golden scenario**

Enqueue two turns, admit the first, publish streaming state, atomically settle
terminal state, restart the bot at each checkpoint, paint Discord, record the
terminal outcome, and prove only then that the second turn can be claimed.
Repeat with a lost admission response and a lost parked callback.

The contract matrix must also cover duplicate ingress, independent continuation
keys, lease expiry, admission ambiguity, render revision collision, stale
outcomes, reset cutover, two-click HITL races, current-role downgrade, and one
scheduled occurrence converging to one visible result. Once, deliberately break
an admission fence, role check, and paint barrier to prove the new tests fail.
Lua-emulating fakes can be deleted only after the real-script tests overlap.

#### Phase 0 checkpoint

The first real-Redis suite now runs the production Upstash client and Lua through
pinned Redis 6.2 and `serverless-redis-http` containers. It covers queue dedupe,
FIFO, lease takeover, independent keys, reset cutover, lost-response admission,
ambiguous-admission recovery publication, one-winner HITL,
interaction-receipt duplicate and conflict fencing, reset staleness, lost render
callbacks, render claim/renew/release/discard, authorization indexing,
scheduled-fire claim/complete/release, and a two-turn
streaming/terminal/restart flow with a stateful Discord fake. All 27 production
conversation Lua scripts now execute in the real-Redis suite; the restart case
also proves queue completion stays pending until the terminal outcome exists. The
feature-parity artifact now also freezes each skill's policy role, description,
criteria, tool membership, and normalized instruction digest, independent of
the activation protocol. A table-driven policy test now covers anonymous,
public, organizer, and admin discovery and loading across all eleven domains,
including exact `Unauthenticated`, `Forbidden`, and `NotFound` precedence. Bot
command fixtures now also pin nominal channel projection and writes,
managed-guild confinement, webhook credential omission, and typed rate-limit
mapping without blessing malformed partial responses. The initial golden run
exposed a real coordinator
lifetime bug: `applyLatest` returned a pending traced Promise from inside
`try/finally`, so `finally`
released the render lease before its checkpoint. Awaiting the traced operation
inside the lease scope restored the stated behavior; the golden suite now
passes and runs in CI. This was a narrow correctness repair, not an approved
architecture refactor. The planned Phase 0 characterization is now complete;
add further fixtures only when an approved migration exposes a specific
uncovered ambiguity.

### 1. Replace the custom skill system with Eve-native dynamic skills

This is the first production slice because it removes the clearest parallel
framework and does not touch the conversation state machine.

**Target**

```text
packages/agents/agent/subagents/<domain>/
├── instructions.md
├── skills/catalog.ts   # defineDynamic + defineSkill
└── tools/catalog.ts    # independent step.started tool resolver
```

Each `skills/catalog.ts` directly exports `defineDynamic` from `eve/skills` with
a `turn.started` resolver. It returns the role-permitted map of `defineSkill`
values. Eve advertises them and owns `load_skill` and loaded-turn context. A
migration canary must prove the installed Eve runtime gives each integration
subagent a usable sandbox context for dynamic-skill materialization and reload.
If that canary fails, stop and resolve the Eve-native lifecycle; do not add a
second loader. An isolated Eve 0.29.5 eval has already proven the framework
path with `just-bash@3.0.0`: `defineDynamic` materialized a `defineSkill`
package and sibling file, native `load_skill({ skill: "probe" })` returned the
exact Markdown, and the mock-model turn passed all three lifecycle gates. This
proves local API/backend feasibility, not deployed durability. `just-bash` is
an optional peer backed by an app-local cache, so keep Eve's `defaultBackend()`
for deployment unless a production canary also proves a pinned just-bash cache
can be written and restored across turns.

The cutover canary also passed against the actual rendered Linear `issues`
definition through a compiled `defineDynamic` module with no authored sandbox.
Eve selected `defaultBackend()`'s local Docker backend: native `load_skill`
returned the expected Markdown on two turns of one preserved session, then a
resolver result of `{}` removed the package and the same forged name failed with
`No skill named "issues".` All four eval gates passed. Repository `eve info` and
`eve build` also report zero diagnostics and compile one `turn.started` skill
resolver plus one `step.started` tool resolver for each of the eleven integration
subagents. This proves compiled discovery, local default-backend materialization,
follow-up reload, and fail-closed removal. It still does not prove hosted sandbox
reattachment, which remains a deployment canary rather than a reason to restore
the deleted loader.

The tool catalog resolves separately on `step.started` from the current role and
the existing tool descriptor policy. It does not read model messages or
`load_skill` results. All permitted tools may therefore be visible before a
skill is loaded; approval and execution revalidation remain unchanged.
Credential/configuration readiness remains an execution-time typed failure, as
it was before this cleanup.

This intentionally trades the custom activation protocol for a larger
library-native tool catalog. A source-level JSON Schema estimate for an
organizer measured GitHub at 109 visible tools / 64,642 serialized bytes
(current base: 4 / 2,672; largest base-plus-one-skill: 16 / 9,872) and Vercel at
166 / 60,471 bytes (current base: 8 / 3,966; largest: 42 / 15,697). Provider
tokenization will differ, but the direction is material. Approving Group A
therefore accepts policy-visible tools being present before `load_skill`, as
Eve documents, in exchange for deleting activation markers, history parsing,
and the parallel loader. If that prompt/tool-selection cost is unacceptable,
stop Group A and seek separate approval for native Eve connections or a
subagent partition; do not recreate a custom loader by accident.

**Delete after parity passes**

- `packages/agents/skill-sources/**`
- `packages/agents/scripts/skill-manifest.ts`
- `packages/agents/scripts/compile-skills.ts`
- `packages/agents/scripts/format-generated-skills.ts`
- all 11 `subagents/<domain>/lib/skills.generated.ts`
- all 11 `subagents/<domain>/lib/skills.ts`
- all custom `load_skill` definitions, activation strings, loaded-skill message
  parsing, and duplicate `turn.started` catalog resolvers
- compile/format hooks whose only purpose is the generated skill tree

The 104 loadable skill names, descriptions, instruction bodies, role minima,
and reviewed 659 tool names remain exact. Before deletion, the version-2 parity
artifact was normalized to the version-3 shape and compared equal across all
11 domains, 104 skills, 659 tools, 13 subagents, and both auxiliary subagents;
the new check also rejects registry tools absent from the base/skill union. The
11 root skill documents were reviewed against subagent instructions, and useful
terminology and safety details were retained in `instructions.md` before the
second copy was deleted. `check-feature-parity.ts` now inspects native catalogs
and registries rather than regexing source format.

**Validation**

- Public/Organizer/Admin discovery table for every subagent
- native `load_skill` returns the expected instructions
- no cross-subagent skill leakage
- repeated loads are Eve-idempotent
- tool visibility is role/policy based, not load-history based
- denied skill/tool names are absent and direct execution still fails closed
- `eve build`, `eve info`, serialization invariant, and unchanged parity set

**Estimated reduction:** about 2,000–3,000 production TypeScript lines plus the
3,381-line duplicate Markdown source tree. The architectural reduction is more
important than the exact line count.

### 2. Centralize the conversation aggregate and reconciler — implemented

Group B changed ownership while preserving the existing keys, values, TTLs,
wire payloads, component IDs, and terminal strings. Redis remains the durable
coordination boundary.

**Implemented**

- Persisted shapes used only to construct Lua arguments remain local to their
  transition modules. The stored render projection keeps its real read-time Zod
  validation in `render.ts`; aspirational unused schema exports are not retained.
- `packages/shared/src/conversations/store.ts`: the only exported Redis-facing
  conversation API. Internal files may separate Lua by aggregate, but callers
  see one `ConversationStore`.
- `packages/bot/src/conversations/flow.ts`: the only bot-side reconciler and the
  commands `submit`, `answer`, `reset`, `admitSchedule`, `wake`, `start`,
  `sweep`, and `stop`.
- Existing focused adapters remain in `agent/client.ts`, `agent/render/`,
  `agent/hitl/interaction.ts`, and `agent/scheduled.ts`; no pass-through
  `conversations/{discord,eve}.ts` wrappers were added.

The implemented store deliberately retains `redis.eval` and the production Lua
bodies. Adopting `Redis.createScript<TResult>()`, changing decoders, or
normalizing TTLs would be a separate behavior-sensitive change. Atomic Lua was
not replaced with pipelines or transactions.

**Transition ownership moved out of**

- `packages/bot/src/agent/queue.ts`
- `packages/agents/agent/lib/discord/coordination.ts`
- `packages/agents/agent/lib/discord/render-intent.ts`
- `packages/bot/src/agent/render/store.ts`
- `packages/bot/src/agent/hitl/store.ts`
- `packages/agents/agent/lib/discord/interaction-receipt.ts`
- authorization scripts in `packages/agents/agent/channels/discord.ts`
- scheduled-fire scripts in `packages/bot/src/agent/scheduled.ts`

The implementation preserves separate Eve admission confirmation and bot queue
acknowledgement because they fence different crash windows. It removes duplicate
script/key ownership, not an acknowledgement merely because two functions have
similar names.

`ConversationFlow` replaces `createAgentSeam`'s mutable `recoverParked` callback
cycle and the in-memory terminal waiter. Wakeups enqueue reconciliation and
return promptly. Reconciliation claims the newest desired render, materializes
it, records `applied|discarded`, and advances exactly one queued turn. The
queue-completion Lua transition itself checks the terminal outcome instead of
relying only on caller ordering.

**Keep explicit**

- renderer projection/checkpoint algorithm and exact terminal error strings
- recovery-required behavior and authorized reset remediation
- current-role resolution and second-party execution authority
- callbacks as optional wakeups plus startup/periodic ready-set recovery

**Validation**

All phase-0 contracts, crash-point rendering, malformed persisted records,
reset/HITL races, startup recovery, and existing exact-error assertions. No key,
TTL, wire payload, or custom-ID change is allowed in this slice.

**Implemented result:** 2,607 production TypeScript lines were added or moved
and 2,453 deleted (net +154); tests grew. The store intentionally keeps the Lua
and branch-heavy durability logic, so the result is ownership centralization,
not aggressive line-count deletion. The old router, render coordinator,
in-memory terminal waiter, mutable callback cycle, and runtime-owned Redis
implementations were deleted.

### 3. Make the Discord command boundary typed and discord.js-native

**Current problem**

`packages/bot/src/agent/discord-commands/handler.ts` converts every REST result
to `Readonly<Record<string, unknown>>`. `record()` returns `{}` and `records()`
returns `[]` on malformed data, so invalid Discord responses can cross the wire
as successful partial summaries.

**Change**

1. Pass the ready `Client<true>` (or managed `Guild`) to the executor instead of
   a hand-narrowed REST-only object.
2. Use discord.js managers/entities and guards for channels, members, roles,
   events, messages, and webhooks where they fit. Use `Routes` for remaining
   raw endpoints.
3. For raw REST, assert once at the endpoint boundary to the matching type that
   discord.js re-exports from `discord-api-types/v10`, such as
   `RESTGetAPIChannelResult`, `RESTGetAPIGuildMemberResult`, and the matching
   list results. Do not recreate those interfaces.
4. Extend the project-owned Discord command schema table with strict output
   schemas. Infer response summary types from Zod. Validate bot output and agent
   decode; malformed upstream data becomes a typed `UpstreamError`, never an
   empty success.
5. Keep one readable exhaustive operation dispatch. Do not create 68 tiny files
   or pass-through handler factories merely to remove a switch.
6. Generate/derive operation set equality from the shared schema keys so the 68
   wire operations, tool names, and executor cases cannot drift.

**Delete**

`unknownRecordSchema`, `record`, `records`, most `compact` calls, external-shape
string indexing, and any locally recreated REST result interfaces.

**Keep**

managed-guild checks, webhook secret omission, media download bounds, error
classification, semantic project summaries, and the bot-only REST principal.

**Validation**

All 68 canonical inputs, strict extra-key rejection, REST method/path/body/query
projection, representative valid response families, malformed-response typed
failure, JSON-safe output, and exact set equality across contracts/tools/cases.

This phase may be line-count neutral because strict project-owned output schemas
replace loose code. Its success metric is removal of unknown-record branching
and compile-time drift, not raw deletion.

### 4. Collapse repeated domain policy/tool scaffolding

Consolidate behavior, not domain API clients.

**Shared agent-local code**

- one project-owned `DomainToolSpec` and policy runtime for visibility,
  approval, second-party authority, execution recheck, execution-time provider
  configuration checks, error conversion, audit, and output projection
- one descriptor registry keyed by domain/tool instead of 11 identical
  `descriptors.ts` implementations
- one usage hook implementation and one parameterized audit hook for the nine
  domains with identical behavior

Each Eve dynamic catalog must still call `defineTool` with an inline `execute`
function so replay reconstruction works. The inline function delegates to the
shared policy runtime; do not hide `defineTool` inside a factory Eve cannot
transform.

**Delete or reduce**

- the duplicated bodies of all 11 `subagents/<domain>/lib/runtime.ts` files
- eleven 33-line descriptor modules
- eleven 25-line identity `define-tool.ts` wrappers used by 713 declarations;
  declarations use `satisfies DomainToolSpec` instead
- 13 byte-identical usage hooks (retain thin discovered re-exports only if Eve
  filesystem discovery requires them)
- nine copied audit hooks and the duplicate `Requested` audit ownership path
- pass-through `createAuditStore`, per-domain lazy store getters, and one-use
  integration/error helpers when direct construction is clearer

Keep GitHub/Sentry/Vercel redaction, Discord error mapping, provider clients,
Zod tool inputs, budgets, immutable audit records, and execution-time current
role checks as explicit adapters.

**Estimated reduction:** 2,800–3,500 production lines across runtimes,
descriptors, identity helpers, hooks, and repeated agent declarations.

### 5. Derive external types and remove small accidental helpers

Apply these mechanical changes with the owning phase rather than as a large
unrelated churn commit.

| Current declaration                      | Replacement                                                           |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `lib/discord/state.ts: AuthAttributes`   | `SessionAuthContext["attributes"]`                                    |
| test-local Eve `Attributes`              | the same exported Eve projection                                      |
| `framework/observability.ts: MetricSink` | `Pick<typeof Sentry.metrics, "count"                                  | "distribution">` |
| `agent/client.ts: AgentFetch`            | `typeof globalThis.fetch`                                             |
| Redis eval ports in coordination/queue   | `Parameters<RedisClient["eval"]>` or removal into `ConversationStore` |
| shopping `NewCartItemInput`              | `Pick<typeof shoppingCartItems.$inferInsert, ...>`                    |
| Linear issue relation object             | `z.output<typeof issueRelationSchema>` projection                     |
| duplicate `JsonValue` definitions        | one project-owned strict JSON type                                    |
| supervisor/release-check health guards   | shared `healthReportSchema` + `z.output`                              |
| active-generation manual parsers         | shared `activeBotGenerationSchema` + `z.output`                       |
| `framework/commands.ts: CommandBuilder`  | discord.js `SlashCommandBuilder` directly                             |

Remove `defineCommand`, `commandName`, unused `toRegistrationBody`, unused
`observeWith`, and other identity/one-use helpers when their call sites are more
readable with `satisfies` or a direct expression.

Keep manual types for Wack Hacker wire/storage/domain summaries, narrow injected
ports with real alternate implementations, and runtime Zod decoders for
untrusted HTTP/DB/Redis data. Keep the Better Result import seam unless a
separate dependency change produces measurable simplification: it avoids 117
cross-workspace import edits and adds the project-owned `fromNullable` helper.
The unexported upstream retry config justifies the small local retry-policy type.

### 6. Lower-priority library-native cleanup

Only after the central slices are green:

- Replace the global shutdown registry in `packages/bot/src/lifecycle.ts` with
  `AsyncDisposableStack`, using discord.js `Client` and Bun server disposal plus
  explicit queue-drain defers. Keep signal and uncaught-error policy.
- Replace `schedule-store.ts` field-by-field row helpers with a schema-derived
  strict Zod decoder while retaining raw libSQL conditional claims and immutable
  migrations.
- Share health/active-generation schemas with supervisor and make
  `sandbox-admin.ts` call the production generation store rather than repeat
  Redis constants/parsers.
- Consider Bun's route table for static bot routes only if pure injected handler
  tests remain simpler. The current switch is not a priority.
- Evaluate official Eve OpenAPI/MCP connections for API-heavy domains in a
  separate approved spike. Do not adopt them if they bypass current role,
  budget, approval, redaction, or audit behavior.

Do not split the 1,365-line supervisor reconciler merely to reduce file length;
its fencing/cutover sequence is cohesive. Extract only genuinely shared schema
and store behavior.

## Expected result

The conservative target is 6,000–8,000 fewer production TypeScript lines, with
new contract tests partly offsetting the repository-wide net deletion. More
important outcomes are:

- one native Eve skill lifecycle instead of two
- one conversation transition model and Redis API instead of cross-package Lua
- one shared policy execution path instead of eleven clones
- one strict Discord command contract instead of unknown records
- external types imported or derived from their owners
- fewer composition callbacks, identity helpers, source-shape generators, and
  mock-driven ports

## Validation gates for every production slice

1. `bun run format:check`
2. `bun run typecheck`
3. `bun run lint`
4. `bun run test`, plus the relevant real-Redis contract suite
5. `bun run build` and Eve `build`/`info`
6. unchanged reviewed capability names unless separately approved
7. `bun run audit`
8. fresh and repeated Drizzle migrations when database code changes
9. Linux/amd64 bot image build when runtime/package code changes
10. `git diff --check`

A diff gate must flag any changed wire schema, Redis key/TTL, custom component
ID, migration, tool/skill name, authorization rule, or terminal error string.

## Approval requested

Approval may be given for all items or individually:

- **A — Eve-native skills:** remove the custom loader/compiler/history system
  and make tools independently role/policy visible. This intentionally
  changes model-visible tool timing, not execution authority.
- **B — Conversation ownership (approved and implemented):** all conversation
  records/scripts are behind shared `ConversationStore`; bot `ConversationFlow`
  owns reconciliation; completion Lua requires a terminal render outcome while
  preserving current keys and wire formats.
- **C — Discord contract:** pass `Client<true>`, derive Discord API types, and add
  strict project-owned output schemas to the bot-agent command wire.
- **D — Domain runtime:** replace 11 copied policy runtimes and identity helpers
  with one agent-local implementation plus explicit provider adapters.
- **E — Mechanical/native cleanup:** apply the type derivations, helper deletion,
  disposal stack, schedule row decoder, and shared supervisor schemas described
  above.

Implementation should start only after the corresponding approval. The planned
execution order is phase 0, A, B, C, D, then E, with full validation after each
mergeable slice.
