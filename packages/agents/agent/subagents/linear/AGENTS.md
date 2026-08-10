# `linear` — notes for adding a tool here

Written for whoever extends this domain, not for the agent that runs it. Runtime
guidance belongs in `instructions.md` and `lib/skill_defs/*.md`; this is what the
upstream API does and where it will surprise you.

## Upstream

`@linear/sdk` with `LINEAR_API_KEY`. The SDK is a GraphQL client that returns
lazy relation accessors, so a field that looks present may be a promise.

## Shape of the API

Membership is the surface that touches real people. `add_member_to_platform`
and `invite_user` send actual email, so an address must be confirmed verbatim
rather than inferred; `remove_member_from_platform`, `suspend_user` and
`add_user_to_team` change what someone can see. The `membership` skill is
admin-gated for that reason.

## Adding a tool

New tools go in `lib/tool_defs/<bundle>/<tool>.ts`, one per file, where
`<bundle>` is the name of the skill that lists it (or `base`). Register it in
`lib/registry.ts` under `LINEAR_TOOLS` and add its name to the skill's `tools`
array — `check:capabilities` fails if a tool is unreachable from every skill and
the base set, or if a skill names a tool that does not exist. Then run
`bun run --filter @repo/agents readmes`; the README's tables are generated and
CI fails when they are stale.
