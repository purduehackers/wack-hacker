# Storage, supervision, and operations

## Storage overview

Two durable services have deliberately different jobs:

- **Upstash Redis** — coordination, leases, idempotency receipts, short-lived
  authorization/budget/telemetry state, bot generation fencing;
- **Turso/libSQL** — relational schedules, application-append-only action
  audit, and the global shopping cart.

The bot has Redis credentials but no Turso credentials. Eve has both. The
bot supervision adds container-management credentials to the agent deployment.

## Redis ownership outside the conversation aggregate

The [conversation engine](conversation-engine.md) catalogs its 20 private key
families. Adjacent owners use these additional families:

| Key                                      | Owner                  | Retention/meaning                                                    |
| ---------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `dedup:<handler>:<eventKey>`             | bot gateway router     | Five-minute handler-scoped event claim                               |
| `bot:interaction:<interactionId>`        | slash dispatcher       | 24-hour command interaction claim                                    |
| `bot:schedule:<name>:<IndianaMinute>`    | bot local scheduler    | 14-day nominal occurrence claim                                      |
| `image-drop:<threadId>`                  | image drops/hack night | 30-day drop record: batch, source, linked CMS event                  |
| `image-drop:attach-notice:<threadId>`    | image drop uploads     | 30-day claim; one "cannot write the event" notice per thread         |
| `hack-night-thread:<threadId>`           | image drops (legacy)   | Pre-drop seven-day slug string; read as an unlinked hack night drop  |
| `turn-message:<messageId>`               | bot renderer           | Seven-day terminal agent-reply index for reset/feedback              |
| `agent:turn-tokens:<sessionId>:<turnId>` | Eve telemetry          | 24-hour token total; adjacent event-ID set deduplicates usage events |
| `policy:approval:<sessionId>:<callId>`   | policy runtime         | 15-minute second-party authority record                              |
| `budget:tokens:<UTC date>:<userId>`      | usage/policy runtime   | 48-hour counter retention; public daily threshold 250,000            |
| `wack:bot-sandbox:active:v1`             | bot-supervisor sched.  | Validated/canonical current bot generation record                    |
| `wack:bot-sandbox:supervisor:v1`         | bot-supervisor sched.  | Owner/generation mutex, ten-minute renewable TTL                     |
| `wack:bot-sandbox:fence:v1`              | bot-supervisor sched.  | Monotonic generation counter                                         |

No runtime uses `KEYS *` for recovery. Durable sets and narrow known keys are
read through their owner APIs.

## Turso connection and schema

`packages/shared/src/db/index.ts` builds a web libSQL client and Drizzle database
from caller-supplied URL/token, then memoizes the first process-wide handle. This
keeps environment resolution in each executable and avoids recreating HTTP
agents per query.

### `scheduled_tasks`

Durable task fields are:

- identity/ownership: ID, owner ID, Discord channel ID;
- semantics: description, action type (`agent`/`message`), prompt;
- authority fallback: creation-time raw member roles;
- schedule: once/recurring, cron/timezone shape;
- lifecycle: active/cancelled/completed/failed, `next_run_at`, `available_at`;
- fencing/retry: lease token/expiry, attempt count, last error/dispatch;
- accounting: fire count and timestamps.

Database CHECK constraints enforce action type, once-vs-recurring nullability,
and nonnegative attempts/fires. Due and owner indexes support lease claiming and
owner-scoped listing. Application row decoders add strict enums, safe integers,
JSON roles, exact selected columns, and cross-field validation.

### `action_audit`

Application-append-only policy history stores user/role/source,
delegate/tool/risk, redacted input hash and preview, reason, decision, optional
approver (`decided_by`) and trace ID. User/time and tool/time indexes support
admin queries. Live approval records remain in Redis; this table is their
long-term accountability trail. There is no database trigger or restricted
writer shown that mechanically forbids UPDATE/DELETE: append-only is an
application and operations invariant.

### Shopping cart

There is one shared `shopping_carts` row (`id="global"`).
`shopping_cart_items` references it with cascade delete. Unique
`(cart_id, asin)` makes repeated adds an increment/upsert rather than duplicate
lines.

## Migration history

Migrations are forward-only files in `packages/shared/migrations`:

| Migration                | Effect                                                                        |
| ------------------------ | ----------------------------------------------------------------------------- |
| `0000_normal_zombie.sql` | Baseline: action audit, scheduled tasks, shopping cart and carts, all indexes |

There is one migration because there is no deployed database to preserve. Once
this baseline is applied anywhere real it becomes immutable: a fix after
application must be a new migration, never an edit. That immutability is
enforced by policy, review, and rehearsal evidence, not by a committed per-file
checksum manifest. Verification checks the repository's latest migration
hash/ledger state and a required schema subset.

`db:migrate` applies whatever the Drizzle ledger has not recorded; on an empty
database that is this baseline and nothing else. Operators must never hand-write
a ledger marker. `verify-database.ts` checks quick integrity, repository
migration hash/ledger, and required tables/columns.

The production workflow asks an operator to assert stopped ingress/drained
writes, verifies database identity, creates a point-in-time clone, runs forward
migrations, verifies integrity, and only then deploys Eve. The
assertion is not a technical fence: stopping the bot leaves the once-per-minute
Eve schedule dispatcher able to claim/fail due Turso rows. Routine migration is
therefore blocked until the whole agent writer set is externally proven idle or
a real maintenance fence exists. Stopping the bot does not stop the Eve
dispatcher, so a migration needing exclusive writes takes the agent down/
re-enable; current schedule create/cancel smoke is separately blocked by the
approval projection limitation. The exact warnings are in the
[database runbook](../operations/database.md).

## Optional bot Sandbox supervision

### Why it exists

The Discord gateway needs one always-on process, while Vercel Sandbox has a
24-hour maximum lifetime. `agent/schedules/bot-supervisor.ts` is a five-minute
Eve schedule in the agent deployment that ensures a healthy, digest-pinned
candidate and rotates before expiry.

It is not needed when the bot already runs somewhere that stays up — a
developer's machine during local work: leave `BOT_SANDBOX_ENABLED=false` and the
tick returns immediately. The application code and bot image remain the same.

Do not conflate three Sandbox surfaces, which now share one deployment:

1. schedule-created bot host containers, tagged
   `managedBy=wack-hacker, workload=discord-bot`;
2. Eve-owned 30-minute code-subagent sandboxes;
3. Vercel provider tools that inspect/manage team Sandboxes.

They have separate lifetimes and policy, and only the first is fenced by the
generation record. Before a destructive Vercel provider tool acts on a Sandbox,
operators should compare its name against the active bot generation; provider
tools do not automatically exempt the supervised bot.

### Entry and configuration

There is no HTTP entry point and no separate deployment. Eve compiles
`agent/schedules/bot-supervisor.ts` into a Nitro task registered on the `*/5`
cron; each tick:

1. returns immediately when `BOT_SANDBOX_ENABLED` is false;
2. assembles and validates the bot container environment per tick
   (`agent/lib/bot/supervisor-config.ts`), so a missing credential, a mutable
   image tag, or two of three Vercel variables fails this schedule alone and
   leaves channels, tools, and dispatch serving;
3. calls `createBotSandboxSupervisor(...).ensure()`;
4. emits `bot.sandbox.ensure` with status/generation/name/image/expiry, or the
   error tag, plus an `agent.bot_sandbox.ensure` counter.

Because the trigger is a schedule rather than a request, there is no on-demand
reconcile: promotion waits for the next tick. A missed tick costs at most five
minutes, and a concurrent one loses the Redis mutex race harmlessly.

`BOT_IMAGE` must be a valid lowercase repository ending in
`@sha256:<64 lowercase hex>`. Mutable tags and bare repositories fail.

### Fencing records

The shared active generation schema contains:

```text
version: 1
generation: positive integer
sandboxName: nonempty
commandId: detached bot command
image: exact digest reference
healthUrl: undecorated HTTPS /health
activatedAt, expiresAt: ISO timestamps
```

The decoder requires and canonicalizes those fields while ignoring additive
record fields; wrong/missing/decorated values fail. “Supervisor-owned” is an
application ownership convention, not a Redis ACL or MAC: the deployables use
general Redis credentials. The schema permits any HTTPS origin whose path is
exactly `/health`; the agent derives that origin and sends `BOT_INGRESS_SECRET`
to it. A compromised writer that inserts a valid-looking record can therefore
redirect/exfiltrate the service bearer until reconciliation. Redis integrity is
a trust boundary, not merely cache availability.

The supervisor mutex is acquired by one Lua transaction: absence check,
monotonic `INCR` fence, and `SET owner:generation PX 10m`. Each invocation may
increase the fence even when a healthy generation is reused; gaps are normal.
Renew/release compare the exact lease.

Generation commit is a Redis CAS requiring all of:

- current lease ownership;
- exact prior generation and Sandbox name, or prior absence;
- next record generation equals the acquired fence;
- strictly monotonic generation.

A stale supervisor cannot commit, renew, release, or delete a newer candidate.

### Healthy reuse

The active instance is reused only if:

- SDK record exists and is running;
- it is nonpersistent, one vCPU, exact desired image/digest;
- more than 30 minutes remain;
- derived health URL exactly matches the stored URL;
- live health contains valid canonical ready fields.

Malformed active records fail closed rather than falling back to `BOT_URL` or
silently rebuilding. Agent `resolveBotBaseUrl()` uses static `BOT_URL` only when
there is no active record; present expired/malformed state is an incident.

### Candidate and handoff

```text
ensure()
├─ validate image, bot env and credentials
├─ acquireLease()                         # monotonic fence + mutex
├─ reconcile()
│  ├─ read/validate/canonicalize active
│  ├─ inspect SDK object and health
│  ├─ reuse + orphan sweep, or
│  └─ create candidate
│     ├─ nonpersistent, 1 vCPU, 24h, managed generation tags
│     ├─ run detached bot command
│     ├─ poll bounded canonical /health and renew lease
│     ├─ commit active generation CAS
│     ├─ SIGTERM/drain/stop/delete previous
│     └─ sweep safe older orphans
└─ releaseLease()
```

Vercel custom images do not execute Docker CMD automatically. The reconcile
runs `bun --preload src/instrument.ts run src/index.ts` at
`/app/packages/bot`. Health polling allows two minutes, every two seconds, with a
five-second request timeout; it requires HTTPS, no redirect, exact 200, JSON,
body <= 4,096 bytes, and `ready:true` schema.

The candidate logs into Discord and completes bot recovery before it reports
ready. Active generation is committed _before_ the previous command is drained,
so overlap is intentional. Bot processes are not generation-aware. Safety during
overlap comes from handler dedup, conversation Lua/leases, local schedule
occurrence claims and Discord nonce convergence.

If commit succeeds but old cleanup/orphan sweep fails, the ensure request reports
failure even though Redis may already point to the new candidate. Incident first
response is to inspect active state and health—not blindly delete or retry.

Orphan cleanup lists only managed tags, preserves the active name, and ignores
missing/malformed or newer generation tags. A stale pass cannot delete a newer
candidate. Supervision observability is limited to the agent deployment's task
logs (`bot.sandbox.ensure`), the `agent.bot_sandbox.ensure` counter, and the
inspector's active/mutex summary from `ops-inspect.ts redis` plus
`bun run sandbox list`. There is no status endpoint and no dedicated trace: the
schedule has no HTTP surface at all, so an operator reads its outcome from logs
and Redis rather than by querying it.

### Bot image

The two-stage Alpine image:

- uses one pinned Bun 1.3.14 base digest in both stages;
- installs frozen production dependencies filtered to bot/shared;
- copies no agent dependency tree;
- runs as unprivileged `bun`;
- sets no `TZ`, so the process runs in UTC; the schedule zone is pinned in code
  as `TIME_ZONE` in `packages/bot/src/utils/dates.ts`, not per host;
- listens on port 8080;
- includes a loopback `/health` Docker HEALTHCHECK;
- must be built from repository root for workspace context and for linux/amd64
  when published to VCR.

The filesystem is disposable. Redis owns recovery; snapshots are rejected as
credential/stale-binary drift hazards.

## Health semantics

The bot emits:

```json
{
  "ready": true,
  "websocketPingMs": 42,
  "uptimeSeconds": 123
}
```

The bot emits exactly this object. Shared decoders require these fields and their
bounds but intentionally ignore additive fields for compatible inspection and
supervisor/release checks.

`ready` means Discord gateway ready **and** the final operational latch set after
conversation startup recovery, handler attachment, and local scheduler start.
The HTTP server binds first and returns structured 503 during startup.

Health does not prove Redis/provider/Turso availability, backlog health,
scheduler progress, desired image/generation, or that the process has begun
draining. The supervisor separately validates image and SDK metadata.

## Telemetry and traces

### Bot

Sentry is preloaded before bot code. Default trace sampling is 0.1, PII defaults
are off, and console info/warn/error integration is enabled when a DSN exists.
`traceOperation()` creates spans for gateway, interaction, render and cron work.

`instrument()` produces one terminal wide event. The console reporter:

- counts `bot.operation` by bounded `op`, status and optional error tag;
- records `bot.operation.duration`;
- emits `operation.completed` JSON with high-cardinality identifiers only in the
  log body;
- captures only defects/invariants/untyped failures as Sentry issues.

Expected tagged failures are visible but do not create alert noise.

### Agent

Eve instrumentation records no prompt inputs or model outputs and enables channel
request tracing. Structured agent logs intentionally contain no prompt, output or
exception detail. Metrics cover turns, tokens/cost, delegation, schedule
claim/delivery/settlement, and policy operations with bounded attributes.
Provider audit is best-effort rather than transactional with effects: an audit
failure warns/counts but does not retry a completed upstream mutation. Domain
lifecycle hooks and confirmation approval can each emit Requested rows for the
same call; self-approved, user-denied, timeout, and prompt-failed coverage is not
complete. Redaction is selective, not general-purpose DLP.

W3C `traceparent` is persisted on queued deliveries, render intents and scheduled
payloads, propagated in both directional HTTP headers, and restored when a later
process consumes recovered work. Durable async work therefore remains connected
to its originating Discord/agent trace where possible.

## Inspection and incidents

Use the read-only inspector with operator-populated environment, never copied
production secrets in root env/tickets:

```bash
bun packages/shared/scripts/ops-inspect.ts redis
bun packages/shared/scripts/ops-inspect.ts redis --continuation <snowflake>
bun packages/shared/scripts/ops-inspect.ts redis --dispatch <uuid>
bun packages/shared/scripts/ops-inspect.ts schedules
```

It calls `ConversationStore.inspect*()` rather than restating conversation keys
and omits queued bodies, prompts, tokens and credentials. Reports include:

- active generation summary and supervisor mutex TTL;
- global queue/render-ready counts;
- conversation depth, reset-pending, active/parked/ingress/reset/ready state;
- render target/intent/projection/claim presence, claim TTL and safe outcome;
- up to 100 active/failed schedule summaries.

Never use `KEYS *`, flush Redis, or delete key families during diagnosis. Inspect
health, the agent deployment logs and Sentry first. Follow the
[incident runbook](../operations/incidents.md) for stuck queue/render, schedule,
or Sandbox recovery decisions.

## CI and release control

### Pull request/main CI

`.github/workflows/ci.yml` uses pinned actions and Bun 1.3.14 to run:

1. frozen install;
2. formatting check;
3. lint, which is type-aware and reports TypeScript errors as well;
4. the capability-surface and serialization-boundary gates;
5. production dependency audit;
6. fresh database migration check/apply;
7. application build/Eve build;
8. linux/amd64 bot image build.

CI runs no automated tests: there is no unit-test suite, no skill/tool lifecycle
canary step and no real-Redis Docker contract step. Merges are gated only by the
static checks and builds listed above, so a merge can introduce a runtime
regression — including in conversation-queue Lua and other Redis behavior — with
CI still green. Treat recent merges as live suspects during incident triage.

### Image publication

`image.yml` builds a linux/amd64 immutable VCR candidate with maximum provenance
and SBOM, exports a checksum-pinned Syft SPDX record, blocks fixable
HIGH/CRITICAL findings with Trivy, and keylessly signs image/SBOM/provenance with
GitHub OIDC. Actions and installer versions/checksums are pinned. That workflow
runs on manual dispatch and path-filtered `main` pushes (bot/shared/image/workflow
inputs), not every main commit, and does not explicitly wait for the CI
workflow. There is no ordinary standalone Eve-agent release workflow in this
repository; agent build/deploy mechanics live in package scripts and the broader
database/deployment process.

### Promotion

`image.yml` names the `production` environment, accepts a full known-good digest
and receives a human gate only when required reviewers are
configured in GitHub settings. It verifies VCR platform/digest, the GitHub-stored provenance and SBOM
attestations signed by this repository's `image.yml`, rescans the exact digest,
records the previous active image, updates
and deploys the agent, waits for the `bot-supervisor` schedule to adopt the
digest, then checks active image plus validated bot readiness. Rollback is promotion of a previously retained verified digest,
not tag mutation.

The source of truth for commands and failure handling remains:

- [production deployment and rollback](../operations/deployment.md);
- [database migration and recovery](../operations/database.md);
- [supply-chain controls](../operations/supply-chain.md).

## Operational caveats

- Schedule detection can take about five minutes plus candidate startup, and
  there is no direct command-death watcher or on-demand reconcile trigger.
- Turning `BOT_SANDBOX_ENABLED` off while a generation record still exists
  requires retiring that record first: a present-but-expired record prevents the
  agent falling back to `BOT_URL`, so the agent keeps addressing a sandbox that
  is gone. Do not ad hoc delete generation/fence keys to force recovery.
- VCR repositories are project-scoped and must align with the agent project.
- Bot health can be 200 during Redis, provider or scheduler incidents.
- Hosted Eve `defaultBackend()` reattachment remains an unmet deployment
  cutover canary: current workflows/runbooks do not execute it, and local
  correctness does not prove it.
- Promotion reads the previous active image into a transient step output before
  deploy but writes no durable rollback record. Its GitHub summary is produced
  only after ensure/smoke succeeds and has no `always()` guard; a post-deploy
  failure can therefore leave changed production with no release summary. Use
  the workflow logs and the recorded restore point as evidence.
