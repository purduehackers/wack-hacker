# `discord` — notes for adding a tool here

Written for whoever extends this domain, not for the agent that runs it. Runtime
guidance belongs in `instructions.md` and `lib/skill_defs/*.md`; this is what the
upstream API does and where it will surprise you.

## Upstream

`@discordjs/rest` with `DISCORD_BOT_TOKEN` (`lib/client.ts`, formerly
`lib/rest.ts`).

This is a second Discord client. `packages/bot` holds the gateway connection and
is the single writer for the agent's replies; this one is an ordinary provider
integration. The two keep independent rate-limit buckets on the same channel
routes and both honour `retry_after`.

## Shape of the API

Bulk message deletion only accepts messages under 14 days old. Discord rejects
the rest, and a partial failure leaves the channel half-cleared, so a tool that
reports plain success there is lying.

Deletes are hard: a deleted channel takes its message history, and a deleted
role silently strips every permission granted through it. Nothing here is
recoverable from an API.

## Adding a tool

New tools go in `lib/tool_defs/<bundle>/<tool>.ts`, one per file, where
`<bundle>` is the name of the skill that lists it (or `base`). Register it in
`lib/registry.ts` under `DISCORD_TOOLS` and add its name to the skill's `tools`
array — `check:capabilities` fails if a tool is unreachable from every skill and
the base set, or if a skill names a tool that does not exist. Then run
`bun run --filter @repo/agents readmes`; the README's tables are generated and
CI fails when they are stale.
