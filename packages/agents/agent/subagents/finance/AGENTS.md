# `finance` — notes for adding a tool here

Written for whoever extends this domain, not for the agent that runs it. Runtime
guidance belongs in `instructions.md` and `lib/skill_defs/*.md`; this is what the
upstream API does and where it will surprise you.

## Upstream

HCB (Hack Club Bank) REST, scoped to `HCB_ORG_SLUG`. No API key: only
organizations in Transparency Mode are visible at all, which is why a 404 here
usually means the slug is wrong or the org is not transparent, rather than that
the resource is gone.

## Shape of the API

**The list endpoints take no server-side filters.** `find_transactions`,
`list_open_invoices`, `donation_totals` and a filtered `list_card_charges` all
page and filter locally under a cap of a few hundred records. A result set that
reaches the cap is truncated, not exhaustive, and any total derived from it
understates. A new filtering tool must either respect that cap or say it hit it.

Balances are three separate figures — cleared, incoming (pending), and fee — not
one number.

Donor anonymity lives in the **projection**, not the record: an anonymous
donation is masked to `(anonymous)` with the email dropped as it is shaped for
output. A tool that returns a raw donation record leaks the donor.

## Adding a tool

New tools go in `lib/tool_defs/<bundle>/<tool>.ts`, one per file, where
`<bundle>` is the name of the skill that lists it (or `base`). Register it in
`lib/registry.ts` under `FINANCE_TOOLS` and add its name to the skill's `tools`
array — `check:capabilities` fails if a tool is unreachable from every skill and
the base set, or if a skill names a tool that does not exist. Then run
`bun run --filter @repo/agents readmes`; the README's tables are generated and
CI fails when they are stale.
