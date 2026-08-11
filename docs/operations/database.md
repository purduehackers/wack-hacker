# Production database change

Only the Eve/agent deployment writes Turso; the bot has no database credentials.
Production migrations are forward-only. Every schema change must be compatible
with the currently deployed agent until the new deployment is healthy.

## The path a schema change takes

**On the pull request**, `ci.yml` reviews it. `review-migrations.ts` runs
`drizzle-kit generate` and fails if it produces a file — a schema that moved
without a migration to carry it would otherwise apply nothing on `main` while
the code expects the new shape. It then classifies every statement the branch
adds and posts a table to the PR: what drops data, what makes drizzle rebuild a
table, what adds a constraint existing rows could violate, and what it could not
classify. Anything destructive fails the check.

Destructive changes are not forbidden. They stop being something that can reach
production without a decision, which is the part that matters when the next step
is automatic.

**On merge to `main`**, `database.yml` applies it. That workflow never
generates: the migration was written and reviewed before it merged. It records
the restore point, runs the migrations, verifies the ledger, `PRAGMA
quick_check`, and that required tables and columns exist.

It does not deploy. The agent project is connected to `main`, so the code that
needs the new schema has already shipped by the time the migration runs — which
also means **a migration must be compatible with the agent that is already
serving**, since that agent sees the new schema first.

## Rollback

Turso restores to any point inside its retention window on demand, so the
workflow records a timestamp rather than cloning in advance:

```bash
turso db create <recovery-name> --from-db <database> --timestamp <recorded-timestamp>
```

The clone this replaced was taken before every migration and left an extra
database behind that nothing ever deleted, for a recovery that is equally
available afterwards.

> **Known limitation:** stopping the bot does not stop the Eve once-per-minute
> schedule dispatcher, which can still claim and fail due rows in Turso. There is
> no maintenance fence over the agent's writer set. For a migration that cannot
> tolerate concurrent writes, take the agent deployment down rather than relying
> on bot ingress being idle.

## When a change needs more care

Most migrations need nothing beyond the pull request review. These do:

- **A destructive statement.** The PR check fails on purpose. Decide explicitly:
  split the change so the additive half ships first and the drop follows once
  nothing reads the column, or accept it and note the restore point.
- **A change the currently serving agent cannot tolerate.** The agent deploys on
  merge and the migration runs on merge, in that order but not atomically, so
  the running agent briefly sees the new schema. Additive changes are safe;
  anything that removes or retypes a column the old code reads is not.
- **A migration that cannot tolerate concurrent writes.** Take the agent
  deployment down for the window. Stopping the bot is not enough — the Eve
  dispatcher still claims schedule rows every minute.

Never run `drizzle-kit push` against production, and never hand-insert ledger
rows. `db:migrate` applies every migration the ledger has not recorded; on an
empty database that is the `0000` baseline and nothing else. There are no down
migrations.

## Failure and rollback

- **Migration or verification failure.** The workflow stops before the change
  record, so the run's log holds the restore point. Fix forward with a new
  migration where possible.
- **Application regression, schema still compatible.** `vercel rollback
<previous-agent-deployment-url>` and keep the forward schema. This is the
  normal rollback and needs no database action.
- **Data or schema corruption.** Do not restore in place. Clone from the
  recorded restore point, verify it, mint a token, update the agent project's
  `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, and redeploy. Preserve the failed
  database for forensics.
