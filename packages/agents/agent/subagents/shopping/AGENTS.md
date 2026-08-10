# `shopping` — notes for adding a tool here

Written for whoever extends this domain, not for the agent that runs it. Runtime
guidance belongs in `instructions.md` and `lib/skill_defs/*.md`; this is what the
upstream API does and where it will surprise you.

## Upstream

Two upstreams: SerpAPI for Amazon search (`SERPAPI_API_KEY`) and a Turso/libSQL
table for the cart (`TURSO_DATABASE_URL`). Each tool declares which it needs
with `requires`; the runtime resolves it against `credentials`.

The cart is a wishlist. There is no checkout and no payment path.

## Shape of the API

The cart is **shared and global** — one row set for the whole team, not per
user. `clear_cart` empties it for everyone and the rows are deleted rather than
tombstoned, so nothing undoes it.

`remove_from_cart` and `update_quantity` rewrite the entire item set inside one
transaction: a quantity change is a delete plus re-insert, not an update in
place. Anything added there must stay inside that transaction or it will race.

## Adding a tool

New tools go in `lib/tool_defs/<bundle>/<tool>.ts`, one per file, where
`<bundle>` is the name of the skill that lists it (or `base`). Register it in
`lib/registry.ts` under `SHOPPING_TOOLS` and add its name to the skill's `tools`
array — `check:capabilities` fails if a tool is unreachable from every skill and
the base set, or if a skill names a tool that does not exist. Then run
`bun run --filter @repo/agents readmes`; the README's tables are generated and
CI fails when they are stale.
