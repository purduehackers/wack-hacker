# `figma` — notes for adding a tool here

Written for whoever extends this domain, not for the agent that runs it. Runtime
guidance belongs in `instructions.md` and `lib/skill_defs/*.md`; this is what the
upstream API does and where it will surprise you.

## Upstream

Figma REST with `FIGMA_ACCESS_TOKEN`, scoped to `FIGMA_TEAM_ID`.

## Shape of the API

`modify_variables` is one POST carrying collection, mode and variable changes
together, each entry naming its own `CREATE`, `UPDATE` or `DELETE`. There is no
dry run, and a `DELETE` removes the variable from every file that consumes it.

`update_webhook` is a **full replacement, not a patch** — an omitted
`description` or `status` is dropped rather than preserved. Any update tool
written against this API needs to read current state and send it back.

Comments carry the token owner's identity, not the requester's, so anything
posted reads as coming from the integration.

## Adding a tool

New tools go in `lib/tool_defs/<bundle>/<tool>.ts`, one per file, where
`<bundle>` is the name of the skill that lists it (or `base`). Register it in
`lib/registry.ts` under `FIGMA_TOOLS` and add its name to the skill's `tools`
array — `check:capabilities` fails if a tool is unreachable from every skill and
the base set, or if a skill names a tool that does not exist. Then run
`bun run --filter @repo/agents readmes`; the README's tables are generated and
CI fails when they are stale.
