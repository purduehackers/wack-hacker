# Gold architecture migration audit

This is the evidence checkpoint for the bot-owned Discord/Eve migration. It
separates completed engineering work from production actions that are blocked by
credentials, billing, or a human interaction.

> **Later corrections.** The supervisor has since moved out of its own project
> and into the agent deployment as the `bot-supervisor` Eve schedule, so the
> Discord token and the bot environment now live alongside Eve; see
> [Production deployment](deployment.md#why-there-is-a-supervisor). The
> repository test suite named as evidence below has also been removed, so those
> behaviors are now held by review rather than by a passing run.
>
> **Documentation-audit correction:** component/unit evidence below does
> not prove the authored approval path end to end. Discord self approvals lack a
> policy record and proxied child approvals look up the wrong session identity,
> so these controls currently fail closed before rendering. Root/non-code Eve
> defaults also sit outside the project role/budget/audit spine. See
> [System internals](../system/eve-policy-and-integrations.md#known-discord-approval-projection-limitation).

## Completed and evidenced

- **Discord ownership:** the long-running Bun/discord.js bot exclusively owns the
  gateway, Discord REST, commands, community schedules, HITL components, render
  convergence, and reset reactions. The Eve package has no discord.js or Discord
  REST dependency.
- **Eve ownership:** Eve owns durable sessions, reasoning, semantic desired
  state, tools, Verdex policy, and durable scheduled-task dispatch.
- **Delivery correctness:** Redis-fenced per-conversation ordering, admission
  receipts, terminal paint barriers, parked markers, reset cutover, and
  crash-recovery paths have permanent tests. Expired ambiguous admission ends in
  one visible `recovery-required` render and never replays Eve work.
- **HITL and policy components:** opaque component locators carry no authority.
  Private state, role-refresh helpers, requester/tool/risk/minimum-role bindings,
  distinct second-party approvers, requester-owned execution, and `decidedBy`
  auditing are unit-characterized; the correction above blocks the current
  Discord authored-approval composition. Verdex defaults are read `(public, none)`, write
  `(organizer, none)`, and destructive `(organizer, self)`.
- **Schedule components:** organizer/self policy and execution recheck,
  scheduled-`agent` current-role refresh, departed-member downgrade, narrow
  transient snapshot fallback, overlapping claims, lease recovery,
  1/2/4/8-minute retry, stable occurrence IDs, DST-safe recurrence, receipts,
  and visible remediation are covered. Self-approval composition is blocked as
  above; direct `message` actions intentionally do not refresh owner roles.
- **Migration safety:** applied migration 0003 is byte-for-byte immutable;
  remediation is in 0004/0005. Fresh, repeated, and populated-legacy migration
  rehearsals pass, including preservation of legacy role snapshots.
- **Domain parity:** 11 generated domains expose 659 tools from 104 API skill
  sources across 13 subagents. Static drift and JSON-boundary checks are part of
  the build.
- **Serialization and sandboxing:** every authored `defineTool` executor and
  `defineState` initializer is guarded. Class instances, `Date`, `Map`, `Set`,
  `Result`, cycles, undefined/coerced values, and unsafe array shapes are
  rejected. The code sandbox has repository, symlink, shell, secret-path,
  output, and deadline confinement.
- **Operations:** trace continuation, usage/cost accounting, structured logs,
  readiness, release/rollback/database runbooks, pinned CI actions/base image,
  SBOM, provenance, scanning, signing, and guarded cleanup automation exist.
- **Credential isolation:** Sandbox credentials are reachable only from
  `agent/schedules/bot-supervisor.ts` and `agent/lib/bot/supervisor-config.ts`,
  and no tool exposes them. Sandboxes are deliberately nonpersistent because
  Redis owns durable state.

## Validation evidence

- Clean implementation commit: `fac6ddc` on `migration/eve-bot-split`.
- `bun install --frozen-lockfile`, `bun run validate`, `bun run build`, and
  `bun run audit` pass. The aggregate `validate` and `audit` scripts have since
  been removed; CI now runs `oxfmt --check .`, `bun run lint`,
  `bun run check:capabilities`, and `bun audit` as separate steps. There is no `tsc`
  pass: oxlint is type-aware and reports TypeScript errors itself.
- Tests pass: agents 122, bot 29, shared 8, supervisor 9.
- `eve info`: zero diagnostics, 13 subagents, four root tools, one schedule.
- `drizzle-kit check`, fresh migration, verification, and repeated migration
  pass; production migration 0005 is applied without changing the four existing
  scheduled-task rows.
- Production Eve is ready at `https://wack-hacker-v2.vercel.app/eve/v1/health`.
- The isolated supervisor returns 401 without its cron bearer and 204 with the
  bearer while disabled.
- Reviewed supervisor-project image
  `vcr.vercel.com/purdue-hackers/wack-hacker-supervisor/wack-hacker-bot@sha256:d83b2308f5d2ef27c821f02aff19a7072a037932e93f54a04e23597aa8e59d02`
  passed an actual nonpersistent 1-vCPU x86_64 Vercel Sandbox smoke with Bun
  1.3.14 and `/app/packages/bot` as its working directory; the smoke sandbox was
  deleted.
- A credentialed Discord renderer/HITL smoke in the authorized channel verified
  live components and terminal clearing; its messages were deleted.

## External blockers

`BOT_SANDBOX_ENABLED` remains `false`, so the old bot is untouched and the new
bot is passive. The supervisor already has the image, Redis, Discord identity,
production Eve URL, and both directional ingress secrets. Bot startup still
requires these seven values to be re-entered or rotated because the old Vercel
project cannot export them:

- `PRIVACY_DB_API_KEY`
- `VERCEL_API_TOKEN`
- `DASHBOARD_EDGE_CONFIG`
- `PAYLOAD_CMS_API_KEY`
- `SHIP_API_KEY`
- `PHACK_API_TOKEN`
- `GROQ_API_KEY`

After those are installed, production enablement still requires:

1. a positive Purdue Hackers Vercel AI Gateway credit balance (current model
   calls return HTTP 402);
2. overlap, rotation, stale-active rollback, orphan cleanup, and dedup-outage
   drills with the real generation; and
3. a human Discord user to complete mention → stream → HITL click/modal →
   terminal paint → follow-up → authorized reset. Bot accounts cannot create
   component interactions.

Production Sentry remains intentionally disabled until privacy/retention
approval and a DSN are provided. Live domain API exercises likewise require the
corresponding production integration credentials.
