# Execution deployment affinity

Status: implementation candidate; live rollout remains blocked on the retained
legacy bridge, separate Workflow projects, and parked-session replay below.
No production infrastructure, database or Discord state was changed by this PR.

## Contract

The bot persists a conversation's deployment identity before putting a new
message into the durable queue. It retains that identity across restart, queue
recovery, promotion, rollback, follow-ups, attachments, human-input responses,
steering, reset and root/local-child streams. It no longer reads `AGENT_URL` to
choose a task's execution host. The configuration contains operator-owned
origins; no URL, credential or deployment selector comes from a user payload.

`agent:execution:<continuationKey>` has no TTL. An idle Eve session can outlive the
seven-day queue/render records, so expiring this mapping would be unsafe.
`agent:dispatch-execution:<dispatchId>` snapshots the generation for seven days,
aligned with render/action retention. There is no second task-state machine:
existing delivery admission, ingress, reset and rendering fences still own work.
Redis persistence and a no-eviction policy are therefore release requirements.
Do not delete affinity records to migrate sessions. A future retention tool must
prove the session and every delayed delivery are retired before removing them.

On first contact with an unversioned conversation:

1. Query the authenticated retained deployment's `/discord/execution` bridge.
   The probe resolves the address without starting, resuming or cancelling work.
2. A live owner binds to that legacy deployment. Already pending or claimed work
   also binds there, even if it has not created an Eve session yet.
3. Only a successful, identity-checked absence result with no existing queued work
   permits the configured current deployment. That deployment is probed too; an
   unexpected owner there is a conflict, not permission to adopt a session.
4. A Redis create-if-absent selects one binding under concurrent requests. A
   competing process must obey that winner, even if its current selector differs.

A missing bridge, timeout, malformed response, authentication failure, changed
identity or missing/revoked target refuses dispatch. None means “new session”.
A known delivery whose session has lost its continuation hook also refuses the
probe and requires operator recovery. Malformed active delivery records refuse
both the ownership probe and local route selection; unreadable work is never
treated as an unused continuation. The installed Eve 0.31.3
`dist/src/execution/workflow-runtime.js` returns absence only for
`HookNotFoundError` from `getHookByToken`; other lookup failures propagate. This
is a claim about address ownership, not permission to discard orphaned history.
A live deployment check must prove this against the retained project's actual
Workflow world before enabling new sessions in another project.

Every mutating Discord route and stream-token mint checks the persisted binding,
request generation, actual deployment/project ID, Eve version and sandbox
protocol. An old bot without a generation header receives 409. Existing sessions
use public fixed `Session` handles. Eve 0.81's `from(address).send()` can otherwise
reset stranded sessions automatically; it is used only for a verified new binding
without an owner. An inactive fixed session fails without creating a replacement.

An explicit user reset remains on the bound deployment. After the remote reset
succeeds, the existing reset barrier fences a generation change and clears only
the bound session ID. Late old dispatches and session acknowledgments cannot
attach to the next session. Reset is not used to make an upgrade pass.

## Configuration

The bot requires `AGENT_EXECUTION_TARGETS`. The supervisor passes this exact JSON
to the gateway process and includes it in its existing environment fingerprint.
`AGENT_URL` is optional compatibility configuration and is not a routing fallback.
The agent reads its real `VERCEL_DEPLOYMENT_ID` and `VERCEL_PROJECT_ID`; an explicit
`AGENT_EXECUTION_ID` is available only as the deployment-ID fallback for local
fixtures. The runtime and sandbox protocol are declared by the running code.

Example shape, using placeholder identities that must be replaced with verified
Vercel deployment and project IDs:

```json
{
  "legacy": "dpl_retained031",
  "current": "dpl_candidate081",
  "targets": [
    {
      "identity": {
        "id": "dpl_retained031",
        "projectId": "prj_legacy",
        "runtime": "eve-0.31.3",
        "sandbox": "vercel-sandbox-v1"
      },
      "origin": "https://wack-legacy-123456abc-purdue-hackers.vercel.app",
      "enabled": true,
      "capabilities": ["session-affinity-v1"]
    },
    {
      "identity": {
        "id": "dpl_candidate081",
        "projectId": "prj_candidate",
        "runtime": "eve-0.81.1",
        "sandbox": "durable-bash-v1"
      },
      "origin": "https://wack-candidate-987654abc-purdue-hackers.vercel.app",
      "enabled": true,
      "capabilities": ["session-affinity-v1"]
    }
  ]
}
```

Use immutable Vercel deployment origins, not production/custom aliases. The URL
schema requires the deployment-hash hostname form, and the bridge verifies the
actual deployment ID so even a moved alias cannot impersonate a retained target.
The persisted identity also includes a hash of the normalized origin. Changing
an existing target's origin, runtime, project or sandbox protocol does not migrate
it; it makes its tasks unavailable. Keep every retained target in the map.

Local fixtures may use HTTP loopback origins. Production uses HTTPS. HTTP
redirects are never followed with the ingress bearer. Both deployments need the
existing organization-managed ingress secret and Redis; no personal accounts or
MCP configuration are introduced.

The schema accepts `durable-bash-v1` and `durable-bash-v2` as distinct protocols so
a subsequent replay-safe provider can retain v1 destinations. This slice reports
v1 when its existing provider is enabled. Never relabel old saved state as v2.
`exact-turn-cancel-v1` is reserved for a separately validated capability. It is
not advertised by this change. A route selection alone cannot establish that
an installed runtime implements cancellation correctly.

## Why the legacy Workflow project must stay separate

Pinning the bot's HTTP origin is insufficient for Eve 0.31.3. Its installed
`execution/workflow-runtime.js` function `startWorkflowPreferLatest` passes
`deploymentId: "latest"` when `VERCEL_ENV` is `production`. The same runtime's
`workflow-steps.js` uses it for child turn workflows, and its timeout steps use
it too. An old driver could therefore start a child on a newly promoted 0.81
runtime even when the bot contacted a 0.31 origin.

Keep the legacy project's production/latest runtime on 0.31. Deploy the 0.81
candidate in a separate Workflow project. Configuration validation rejects any
enabled 0.31 target sharing a project with an enabled incompatible runtime,
including retained targets that are not the current/legacy selectors. Changing
the current selector to roll back does not bypass this check. No private Eve
internals are patched. The installed 0.81 runtime has no corresponding
`startWorkflowPreferLatest` path; its public fixed-session and per-deployment
Workflow behavior still requires the live replay below.

## Deployable 0.31 bridge backport

[legacy-session-affinity-0.31.patch](legacy-session-affinity-0.31.patch) applies to
repository commit `8e14f97d4a62be1c64bac45118b85ae58da144d6`, with Eve still pinned
to 0.31.3. It contains the shared affinity records/store, the public-API bridge,
and guarded Discord routes. It does not contain the 0.81 catalog, just-bash,
bot upgrade or dependency changes. The patch declares the correct 0.31 runtime
and native sandbox identity. It was applied to an isolated source snapshot,
installed with the unchanged lockfile, typechecked and compiled locally.

Prepare a dedicated managed worktree at that base, then apply the exact reviewed
patch and validate there:

```sh
git apply --check /absolute/path/to/legacy-session-affinity-0.31.patch
git apply /absolute/path/to/legacy-session-affinity-0.31.patch
bun install --frozen-lockfile
bun run lint
bunx tsc --noEmit -p packages/agents/tsconfig.json
SKIP_ENV_VALIDATION=1 bun run --cwd packages/agents build --skip-sandbox-prewarm
```

The build skips native sandbox publication and proves compilation only. It does
not establish that a retained production session can be resumed. Do not deploy
the patch onto an incompatible base without reviewing the new diff and repeating
the old-runtime checks.

## Rollout and rollback gates

1. Back up the shared Redis state. Keep its existing queue/lease/render data;
   preserve every named legacy Workflow deployment, secret, environment, and
   workspace. Before merging any runtime-upgrade PR, disconnect or pin the
   legacy project's Git production source to its reviewed 0.31 bridge branch.
   An ordinary merge to main must not auto-promote 0.81 into the legacy project's
   latest deployment. Verify the project's actual Git/production deployment
   settings and disable incompatible automated promotions; retaining an old URL
   by itself is insufficient. This operational change is not performed by this PR.
2. Provision the guarded 0.31 bridge in the legacy project with
   `BOT_SANDBOX_ENABLED=false`. Pause and drain old gateway ingress before
   changing the bot: a still-running old bot must not send to an older unguarded
   deployment while the new bot probes absence. Test that generation-less calls
   to the bridge fail before any Eve dispatch. Messages already accepted in Redis
   stay queued and bind to legacy; do not clear queues or resend accepted work
   during the gap. Keep Discord gateway admission disabled until the routed bot
   is ready, and explicitly reconcile any messages received during maintenance
   from durable admission receipts. This change does not claim zero-loss capture
   for Discord messages that no connected gateway process received.
3. Keep exactly one bot supervisor authoritative. Retained deployments must not
   run a supervisor schedule or manual reconcile with their old bot image/env.
   The existing Redis supervisor mutex prevents simultaneous reconciliation; it
   does not prevent alternating old and new configurations. Verify legacy cron
   registration, already queued schedule work and manual triggers are drained or
   disabled before enabling the candidate supervisor. Do not rely on the mutex
   as a configuration ownership mechanism.
4. Start the routed bot with `current` equal to `legacy`. Verify the bridge sees
   known running, idle, self-approval, second-party-approval and child session IDs.
   Confirm callbacks still reach the active bot through the existing generation
   endpoint. Preserve fresh caller role checks and the existing admission fences.
5. Provision the separate candidate Workflow project. Check its authenticated
   identity against the operator target map. For a controlled new conversation,
   switch `current` to the candidate and verify one durable binding, one session,
   attached files, root/child streams, fresh stream tokens and final delivery.
6. Change `current` back to legacy while candidate work is running and waiting for
   input. Accepted candidate tasks must remain there. Exercise duplicate clicks,
   restart, queued messages, target unavailability, explicit reset, and stale
   post-reset actions. Do not reset an old session to pass this validation.
7. Only after those canaries pass may the candidate cohort expand. Measure end-to-end
   latency separately; this routing change is not evidence of a speedup.

A rollback changes only where genuinely new conversations are accepted. Keep the
candidate target and its Workflow project available for everything already bound
to it. A revoked/unavailable target blocks its tasks visibly; restore the same
verified configuration to resume routing. No automatic migration or replacement
is provided.

## Local verification

The tests exercise real Redis CAS/restart/retirement, two local HTTP deployments,
legacy queue backfill, pending answers, immutable identity mismatch, unavailable
probes, revoked targets, attachments, and actual retained-client root/child NDJSON
reads. They run without models, Vercel writes or Discord messages:

```sh
REDIS_TEST_URL=redis://127.0.0.1:16497 SKIP_ENV_VALIDATION=1 bun test packages/shared/src/conversations/execution.test.ts packages/bot/src/agent/execution-targets.test.ts packages/bot/src/agent/routed-client.test.ts
```

These prove the authored routing boundaries. Production Workflow ownership,
deployment protection, OIDC token renewal across projects, live parked approval
replay and supervisor cutover remain release gates.
