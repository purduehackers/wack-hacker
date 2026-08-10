# `vercel` — notes for adding a tool here

Written for whoever extends this domain, not for the agent that runs it. Runtime
guidance belongs in `instructions.md` and `lib/skill_defs/*.md`; this is what the
upstream API does and where it will surprise you.

## Upstream

`@vercel/sdk` **1.19.40** with `VERCEL_API_TOKEN`. The pin matters: 1.28 renamed
the Edge Config accessors to `globalConfig` and dropped the item-write methods,
so this domain still calls `edgeConfig.*`. `packages/bot` has 1.28 and talks to
the REST endpoint directly for that reason.

One of three domains wiring `provider-redaction`, with `redactInput: true`.
Largest domain at 166 tools; its subagent runs `anthropic/claude-sonnet-5` and
deliberately omits the gateway caching block the DeepSeek domains use.

## Shape of the API

**Traffic moves asynchronously.** `promote_deployment`, `rollback_deployment`,
`approve_rolling_release_stage` and `complete_rolling_release` all return before
the change is live, so a tool that reports success is reporting acceptance, not
completion. Anything built here should say which of the two it means.

Read tokens and integration secrets come back on list and get calls;
`lib/redact.ts` drops them and new tools must route through it.

## Adding a tool

New tools go in `lib/tool_defs/<bundle>/<tool>.ts`, one per file, where
`<bundle>` is the name of the skill that lists it (or `base`). Register it in
`lib/registry.ts` under `VERCEL_TOOLS` and add its name to the skill's `tools`
array — `check:capabilities` fails if a tool is unreachable from every skill and
the base set, or if a skill names a tool that does not exist. Then run
`bun run --filter @repo/agents readmes`; the README's tables are generated and
CI fails when they are stale.
