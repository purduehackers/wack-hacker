# Production deployment

## Why there is a supervisor

The bot is one always-on container because it owns the Discord gateway. Vercel
Sandbox has a 24-hour maximum lifetime, so the agent deployment runs a
five-minute Eve schedule — `packages/agents/agent/schedules/bot-supervisor.ts` —
that replaces an expiring sandbox. It holds a Redis fencing lock, starts a
digest-pinned candidate, waits for its structured `/health` readiness response,
atomically publishes the new generation, drains the old command, and removes
safe orphans.

It lives in the agent because Eve already owns a durable cron surface and
because the agent is already the _reader_ of the generation record
(`agent/lib/bot/endpoint.ts`). One deployment owns both sides of that record.
The cost of that choice is deliberate coupling: promoting a bot image is an
agent deployment, and rolling back the agent rolls back the configured bot
image with it.

This supervision exists **only** to bridge Vercel Sandbox's 24-hour turnover. On
Fly, Railway, a VM, or another persistent container host, run the same bot image
under that host's restart/health policy, set the agent's `BOT_URL` to the
persistent service, and leave `BOT_SANDBOX_ENABLED=false`.

Sandbox instances are deliberately **nonpersistent** and replace-on-crash. Redis,
not a sandbox filesystem, owns queues, render intent/projection, receipts, and
the active fencing generation, so a replacement recovers without a disk image.
This supersedes the earlier `getOrCreate`/snapshot plan: snapshotting could retain
injected credentials, stale binaries, caches, and local drift. A crashed or
unhealthy instance is therefore drained/deleted when possible and recreated
from the reviewed immutable image.

## Required GitHub configuration

Configure these before using the release workflows:

- Variables: `VCR_IMAGE` (repository only, for example
  `vcr.vercel.com/team/project/wack-hacker-bot`), `VCR_PROJECT`, `VERCEL_SCOPE`,
  and `AGENT_VERCEL_PROJECT`.
- Secrets: `VERCEL_TOKEN`, `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`, `TURSO_API_TOKEN`, `TURSO_DATABASE_URL`, and
  `TURSO_AUTH_TOKEN`.
- A protected GitHub environment named `production` with required reviewers.
- Vercel project roots and root-level frozen-lockfile install commands as
  described in the repository README. Neither package can be uploaded alone
  because both use the `@repo/shared` workspace.

`BOT_IMAGE` belongs to the agent project and must be a full
`vcr.vercel.com/...@sha256:<64 lowercase hex>` reference. VCR images are
project-scoped: build/login with `VCR_PROJECT` set to the project whose
credentials start the sandbox and use that project's repository path, or Sandbox
creation fails with image-not-found.

## Eve hosted-lifecycle cutover gap

Local canaries prove native skill/tool reconstruction on `defaultBackend()`, but
no current workflow or runbook step verifies hosted sandbox reattachment across
a real deployment. Treat that as an unmet production prerequisite: define and
review a hosted reattachment check before claiming the Eve cutover complete.
Do not replace it with a second loader or infer it from bot `/health`.

## Build, review, and promote

1. Merge to `main`. **Publish bot image** (`image.yml`) builds `linux/amd64`,
   waits until VCR serves the exact digest, scans it, creates an SPDX JSON SBOM
   and BuildKit SLSA provenance, signs the digest with GitHub OIDC, and uploads
   the review metadata. It does not alter production.
2. Review the workflow's digest, SBOM, provenance metadata, vulnerability scan,
   and signature verification. Copy the full digest reference from its summary.
3. Dispatch **Promote reviewed bot digest** (`promote.yml`) with that exact
   reference and the change ticket. The `production` environment is the human
   approval gate. The job re-verifies VCR availability, platform, signature,
   and vulnerabilities before changing `BOT_IMAGE`.
4. Promotion sets `BOT_IMAGE` on the agent project and deploys it, then waits
   for the `bot-supervisor` schedule to adopt the digest — up to five minutes
   for the next tick plus candidate startup. It then reads the fenced
   active-generation record and verifies both the exact image and the bot's
   ready `/health` payload. Do not call a successful Vercel deployment a
   successful bot release until this smoke check passes.
5. Verify one non-destructive Discord command and inspect Sentry/logs for
   `bot.sandbox.ensure`, gateway reconnects, schedule failures, and render
   backlog. Record the previous and current digests in the change ticket.

Local preflight, after `vercel vcr login docker`, uses the same registry check:

```bash
bun packages/shared/scripts/release-check.ts image   vcr.vercel.com/<team>/<project>/wack-hacker-bot@sha256:<digest>
```

## Failure and rollback

Promotion is replace-before-drain: an unhealthy candidate never becomes active.
If smoke fails after commit, **do not rebuild a tag**. Re-dispatch `promote.yml`
with the last known-good, already reviewed digest. This creates a new fenced
generation from the old immutable image and is the bot rollback. Then repeat the
Discord check.

Because supervision now ships with the agent, `vercel rollback <deployment-url>`
on the agent also reverts the `BOT_IMAGE` that deployment carried — but it does
**not** by itself replace the running sandbox, which only the next scheduled
reconcile does. Prefer re-dispatching `promote.yml` for a bot rollback, and
reserve `vercel rollback` for agent code faults.

If a reconcile fails, preserve its logs and the read-only snapshot before
repairing anything:

```bash
bun packages/shared/scripts/ops-inspect.ts redis
(cd packages/agents && bun run sandbox list)
```

- A digest that VCR cannot inspect was never ready for promotion.
- A candidate health failure leaves the previous generation active and attempts
  candidate cleanup.
- A cleanup warning is not permission to delete the active sandbox. Let the
  next ensure pass reconcile it, then use the guarded cleanup below if needed.

## Manual sandbox cleanup

The schedule normally sweeps only its own tagged, fenced orphans. The admin
script is dry-run by default and uses the same tags. Run it from
`packages/agents` so Bun loads that package's ignored `.env.local`; it needs
the Redis REST pair plus `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and
`VERCEL_PROJECT_ID`. It preserves the Redis active name and refuses generations
newer than the active fence:

```bash
cd packages/agents
bun run sandbox list
bun run sandbox cleanup
bun run sandbox cleanup --apply
```

Run `--apply` only after confirming no deploy or reconcile is in flight. For a DB
maintenance quiesce, first redeploy the agent with `BOT_SANDBOX_ENABLED=false` —
the schedule then returns immediately while the rest of the agent keeps serving —
wait for any in-flight reconcile to finish, capture the active name with `list`,
and explicitly stop it:

```bash
bun run sandbox stop-active --confirm <exact-active-sandbox-name> --apply
```

The active Redis record intentionally remains as evidence. Once supervision is
re-enabled, the next reconcile sees the missing sandbox and safely advances to a
new generation. Never delete the fence counter or active-generation key to force
recovery.
