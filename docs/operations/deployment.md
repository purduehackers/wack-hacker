# Production deployment

## Why there is a supervisor

The bot is one always-on container because it owns the Discord gateway. Vercel
Sandbox has a 24-hour maximum lifetime, so `packages/supervisor` is a separate,
credential-isolated Vercel project whose five-minute cron replaces an expiring
sandbox. It holds a Redis fencing lock, starts a digest-pinned candidate, waits
for its structured `/health` readiness response, atomically publishes the new
generation, drains the old command, and removes safe orphans. The Eve deployment
never receives the Discord token; the supervisor receives it only to inject it
into the bot container.

This extra control plane exists **only** to bridge Vercel Sandbox's 24-hour
turnover. On Fly, Railway, a VM, or another persistent container host, run the
same bot image under that host's restart/health policy, set the agent's `BOT_URL`
to the persistent service, and do not deploy `packages/supervisor`.

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
  `SUPERVISOR_VERCEL_PROJECT`, `SUPERVISOR_URL`, and `AGENT_VERCEL_PROJECT`.
- Secrets: `VERCEL_TOKEN`, `CRON_SECRET`, `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`, `TURSO_API_TOKEN`, `TURSO_DATABASE_URL`, and
  `TURSO_AUTH_TOKEN`.
- A protected GitHub environment named `production` with required reviewers.
- Vercel project roots and root-level frozen-lockfile install commands as
  described in the repository README. Neither package can be uploaded alone
  because both use the `@repo/shared` workspace.

`BOT_IMAGE` belongs only to the supervisor project and must be a full
`vcr.vercel.com/...@sha256:<64 lowercase hex>` reference. VCR images are
project-scoped: build/login with `VCR_PROJECT` set to the supervisor project and
use that project's repository path, or Sandbox creation fails with image-not-found.

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
4. Promotion deploys the supervisor, calls `/api/ensure-bot`, then reads the
   fenced active-generation record and verifies both the exact image and the
   bot's ready `/health` payload. Do not call a successful Vercel deployment a
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
Discord check. Roll back the supervisor deployment with `vercel rollback
<deployment-url>` only when the supervisor code itself is faulty; rolling back
its deployment does not by itself change the already active sandbox.

If `ensure-bot` fails, preserve its logs and the read-only snapshot before
repairing anything:

```bash
bun packages/shared/scripts/ops-inspect.ts redis
(cd packages/supervisor && bun scripts/sandbox-admin.ts list)
```

- A digest that VCR cannot inspect was never ready for promotion.
- A candidate health failure leaves the previous generation active and attempts
  candidate cleanup.
- A cleanup warning is not permission to delete the active sandbox. Let the
  next ensure pass reconcile it, then use the guarded cleanup below if needed.

## Manual sandbox cleanup

The supervisor normally sweeps only its own tagged, fenced orphans. The admin
script is dry-run by default and uses the same tags. Run it from
`packages/supervisor` so Bun loads that package's ignored `.env.local`; it needs
the Redis REST pair plus `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and
`VERCEL_PROJECT_ID`. It preserves the Redis active name and refuses generations
newer than the active fence:

```bash
cd packages/supervisor
bun scripts/sandbox-admin.ts list
bun scripts/sandbox-admin.ts cleanup
bun scripts/sandbox-admin.ts cleanup --apply
```

Run `--apply` only after confirming no deploy/ensure is in flight. For a DB
maintenance quiesce, first deploy the supervisor with
`BOT_SANDBOX_ENABLED=false`, wait for any ensure request to finish, capture the
active name with `list`, and explicitly stop it:

```bash
bun scripts/sandbox-admin.ts stop-active --confirm <exact-active-sandbox-name> --apply
```

The active Redis record intentionally remains as evidence. Once supervision is
re-enabled, the next ensure sees the missing sandbox and safely advances to a
new generation. Never delete the supervisor fence counter or active-generation
key to force recovery.
