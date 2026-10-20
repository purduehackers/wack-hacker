# Eve 0.81 main-agent catalog candidate

**Release status: draft; do not merge into an automatically deployed branch yet.**

The agents package pins Eve 0.81.1 to use its native deferred tool and skill
catalog. The bot intentionally retains its 0.31.3 client while its stream follower
understands both event families. This is a tested implementation candidate, not
evidence that existing 0.31 sessions can move to the new backend.

## Behavior and configuration

`MAIN_AGENT_CATALOG_ENABLED=true` exposes all 670 existing integration tools and
106 existing provider skills directly to the main agent, plus 12 provider overview
skills. It defaults to `false` and is included in the agents build environment
allowlist. The flag controls catalog/instruction resolution; **it does not select
the Eve runtime version or make an upgrade safe for old sessions**.

The main agent uses `eve__search`, `eve__tool`, and `eve__skill`. Tools and skills
have stable `domain__name` identifiers. Only selected schemas enter model context;
the system prompt does not include the full catalog. Markdown skills include the
provider's operating instructions and explicitly qualified tool references. They
do not create a sandbox. Provider execution still uses Wack's existing SDK/HTTP
clients and organization credentials. Missing configuration returns an operator
error, never an invitation to connect a personal account or configure MCP.

Provider subagents remain available for substantial independent work and as the
flag-off path. They are no longer the required boundary for ordinary provider
operations when the flag is on. Their existing bare operation names and the old
approval identity attributes remain supported within the new candidate runtime;
this is not a claim that old serialized callbacks are migratable.

Every provider operation retains the original effective organizer admission
floor, including reads whose standalone descriptor previously said public.
Discovery uses the current principal, not the initiating principal. Approval and
execution independently enforce the floor, tool-specific role, risk,
confirmation, budget, readiness, and audit rules. Second-party decisions bind the
exact namespaced tool and call to durable policy, check fresh requester/approver
role assertions, and audit the deciding person while execution remains owned by
the requester. A loaded schema or crafted direct call cannot bypass approval.

## Runtime compatibility changes

- Dynamic execution, schema, and approval callbacks are authored inline and
  capture only domain/tool strings. Eve's compiled callbacks restore live schema
  validators after serialization instead of capturing SDK clients or Zod objects.
- Eve's current `workflow` property replaces `experimental_workflow`; current
  task events replace the old `subagent.*` events in the agents package. The bot
  still understands old events and validates new action/task frames before
  displaying readable progress.
- Root and child usage hooks retain input, output, cache, cost, and parent turn
  totals. Redis totals deduplicate event IDs across retries. Metric emission is
  best effort and is not itself an exactly-once delivery system.
- Streaming consumes new delta frames without losing completed paragraphs.
  `message.completed` does not end a turn. `turn.waiting` keeps the held turn and
  delivery lease alive; `input.resolved` removes only resolved controls. The old
  accepted-input `turn.started` cleanup remains for legacy behavior.
- A successful response HTTP request means **submitted**, not approved. The bot
  sends an ephemeral receipt and leaves public prompts to the render projection.
  Rejected/failed candidates publish a new waiting revision so a person can retry
  without defeating deduplication of their previous click. Acknowledgment cannot
  erase controls even if the rejection paint arrives first.
- `ask_question`, `glob`, and `grep` are explicitly restored at the root and in
  each provider because they stopped being framework defaults. Native questions
  now use the workflow tool and same-turn input lifecycle. No additional default
  framework tools or account connections are enabled. The old framework `todo`
  utility is not provided by 0.81.1 and has not been recreated.
- Provider `outputSchema` on `defineAgent` is no longer supported and is removed.
  Existing provider instructions still request structured findings, but strict
  output-schema enforcement on the legacy delegation path is not preserved.
  Callers needing guaranteed structure must pass a schema through the new
  `ctx.agent.send` interface in a subsequent deliberate change.
- Sentry initializes with `skipOpenTelemetrySetup` and contributes a span
  processor through Eve's single OTel pipeline. Its trace sample rate is applied
  per trace at that destination, leaving Eve's other exporters untouched. Error,
  metric, log, root-span and child-span delivery are tested with an enabled Sentry
  client and a local receiver.
- The recursive markdown diagnostic defect remains in stock 0.81.1. A separate
  narrow patch preserves the 0.31.3 fix without treating imported skill Markdown
  as authored modules. The existing Nitro Markdown text loader remains necessary.

## Existing-session release gate

The installed 0.81.1 `execution/session/checkpoint-migrations.js` accepts checkpoint
versions 8–15. Its older-version upgrades include strict idle-state checks and
reject pending inputs/workflow work in incompatible layouts. The 0.31 backend
predates this supported checkpoint path. A clean build, a flag-off catalog, or a
new 0.81 session cannot establish compatibility for a parked 0.31 session.

Before promotion, the deployment owner must provide and verify all of:

1. A retained, addressable 0.31 deployment that continues running and resuming its
   existing sessions. Keep its workflow code, environment, and credentials.
2. Concrete bot dispatch, input-response, attachment/stream, cancellation, and
   continuation routing to the correct deployment for each session. Persist an
   execution version/deployment reference; do not infer it from the current
   hostname or silently route an old continuation to the candidate.
3. Test-channel replay of running, idle, parked self-approval, parked second-party
   approval, and child sessions through a deployment promotion and rollback.
   Verify fresh role checks, duplicate responses, render leases, and continued
   delivery. Do not reset sessions or substitute a new conversation to pass this
   gate.
4. A controlled cohort of newly created 0.81 sessions, then catalog enablement for
   that cohort, with measured time to first useful output, total completion time,
   child/model call count, tool failures, approvals, and sandbox allocations.

That routing/retention implementation and live replay are outside this PR and
remain blocking. Do not use automatic incompatible-session replacement as a
migration strategy. A rollback must also retain the 0.81 deployment for sessions
already created there; changing a flag cannot downgrade their checkpoints.

## Verification and its limits

The committed tests exercise Eve's actual authored callback transform, dynamic
tool resolution, search/schema selection, Markdown loading, serialization and
callback registry reconstruction. They cover every tool and skill, zero sandbox
calls, fresh-role filtering, unapproved calls, self/second-party decisions,
revocation, cancellation, native approval parking, and restored pending state.

The retained 0.31 client is tested through its real HTTP NDJSON read path with
stream headers 21 and 26, including a held turn. Unlike the intermediate clients
mentioned in Eve's upgrade guide, this reader does not reject version 26. This
verifies the bot's raw stream use, not every old client aggregation API or remote
agent protocol. Remote child streams are not attached to the local origin; a
remote protocol migration would require separate work.

Approval lifecycle source evidence: `harness/tool-loop.js` calls
`acceptHumanInput` before `prepareTurnInput` and `openTurn`.
`harness/hitl/coordinator.js` records rejected, thrown, or timed-out authorizers
without settling the request; the authorizer timeout is 10 seconds.
`harness/hitl/intake.js` then parks through `holdForInput`. Consequently these
responses emit `turn.waiting` without `input.resolved` or a new `turn.started`.
Response-policy and parking tests are separate from the Discord acknowledgment
race test; a full Workflow-backed approval replay is still part of the release
gate above.

Local validation commands:

```sh
bun test packages/agents/scripts/tests packages/bot/src packages/shared/src
bun run lint
bunx oxfmt --check .
bunx tsc --noEmit -p packages/agents/tsconfig.json
bunx tsc --noEmit -p packages/bot/tsconfig.json
SKIP_ENV_VALIDATION=1 bun run --cwd packages/agents check:capabilities
SKIP_ENV_VALIDATION=1 bun run --cwd packages/agents check:serialization
SKIP_ENV_VALIDATION=1 bun run --cwd packages/agents build --skip-sandbox-prewarm
```

Set `REDIS_TEST_URL` to an isolated disposable Redis to run the optional real
Redis tests, including concurrent replay of child and parent usage totals. The
build command deliberately skips native sandbox prewarming because the local
Microsandbox runtime is unavailable; it compiles the application and workflow
artifacts without creating a VM. It does not validate a deployed sandbox, model
quality, external provider writes, or end-to-end Discord rendering. Those claims
require the controlled deployment checks above. Durable just-bash is a separate
stacked change.
