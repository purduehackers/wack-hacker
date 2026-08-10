# Production database change

Only the Eve/agent deployment writes Turso; the bot has no database credentials.
Production migrations are forward-only. Every schema change must be compatible
with the currently deployed agent until the new deployment is healthy.

> **Current maintenance blocker:** stopping the bot does not stop the Eve
> once-per-minute schedule dispatcher, which can still claim and fail due rows in
> Turso. The workflow's `quiesced` checkbox is an operator assertion, not a
> technical fence. Do not run the production migration unless the whole agent
> writer set is externally proven idle for the window; routine use needs an
> explicit agent/scheduler maintenance fence. Also, the create/cancel schedule
> smoke below is blocked by the documented Discord self-approval projection
> limitation.

## Automated path

Dispatch **Migrate production database and deploy agent** (`database.yml`) from
the reviewed commit. Enter the production Turso database name, a new backup
database name, the change ticket, and confirm that all writers are quiesced. Naming the `production` environment
supplies a second human gate only when required reviewers are configured in the
repository settings.

The job refuses a URL/name mismatch, creates a provider-side point-in-time clone
before mutation, applies Drizzle migrations,
runs `PRAGMA quick_check`, verifies that the latest repository migration hash is
in the ledger and that required tables/columns exist, and only then deploys the
agent. The Turso and Vercel CLIs are exact versions; the Turso archive checksum
is verified. On any failure, the bot stays quiesced for operator action.

## Operator sequence

1. Announce a maintenance window. Deploy the isolated supervisor with
   `BOT_SANDBOX_ENABLED=false`, wait for an in-flight ensure to finish, then stop
   the active bot with the guarded command in [deployment.md](deployment.md).
   This closes Discord ingress and the bot's scheduled endpoint, but it does
   **not** stop the Eve dispatcher from updating due schedule rows. Wait at least
   the longest observed agent request and externally prove no live turn,
   provider tool, schedule dispatcher, or other Eve invocation can write for the
   entire window. There is no database read-only or agent-maintenance fence in
   this repository; checking the quiesce box based only on the bot stop is
   unsafe.
2. Record the current agent deployment URL, exact bot digest, database name,
   UTC time, and change ticket. Choose a **new** backup database name; Turso PITR
   cannot restore over an existing database.
3. Run `database.yml`. Do not insert Drizzle ledger rows by hand. `db:migrate`
   applies every migration the ledger has not recorded; on an empty database
   that is the `0000` baseline and nothing else.
4. Review the workflow's database verification and Vercel deployment URL.
   Re-enable supervision, then run `promote.yml` with the last reviewed bot
   digest to create a fresh sandbox against the new agent deployment.
5. Run a non-destructive agent turn and inspect errors/latency. The intended
   create/list/cancel schedule smoke cannot currently complete because
   create/cancel self-approval controls fail before rendering. Do not substitute
   a direct database write or bypass approval. Keep production cutover blocked
   until that limitation is fixed and the full live smoke succeeds.

The equivalent provider backup command, useful for a witnessed manual change,
is documented by Turso and does not copy customer data into CI artifacts:

```bash
BACKUP_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
turso db create <new-backup-db> --from-db <production-db> --timestamp "$BACKUP_AT"
```

A logical dump is an optional second backup (`turso db shell <db> .dump >
dump.sql`), but it contains production data: encrypt it to the approved backup
store, never a GitHub artifact or incident ticket.

## Failure and rollback

- **Before migration:** delete nothing; fix the backup/preflight and re-run.
- **Migration or verification failure:** keep ingress quiesced. Preserve the PITR
  database and logs. Do not deploy the new agent.
- **Application regression with a compatible schema:** use `vercel rollback
<previous-agent-deployment-url>`, re-run smoke tests, and keep the forward
  schema. This is the normal rollback.
- **Data/schema corruption:** never attempt an in-place PITR restore. Create or
  retain the pre-change clone, verify it, mint a token for it, update the agent
  project's `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, deploy the known-good
  agent, and only then re-enable the bot. This is a new production cutover and
  needs the same approval. Preserve the failed database for forensics.

There are no down migrations, and `drizzle-kit push` is forbidden in production.
Never point the old agent at a non-backward-compatible forward schema.
