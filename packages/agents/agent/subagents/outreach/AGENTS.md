# `outreach` — notes for adding a tool here

Written for whoever extends this domain, not for the agent that runs it. Runtime
guidance belongs in `instructions.md` and `lib/skill_defs/*.md`; this is what the
upstream API does and where it will surprise you.

## Upstream

Three upstreams in one domain: Notion (the CRM, via `../../notion/lib/client.ts`),
Hunter.io (`HUNTER_API_KEY`, email finding), Resend (`RESEND_API_KEY`, audiences
and broadcasts) and Cloudflare (`CLOUDFLARE_API_TOKEN`, the 1:1 send).

Each tool declares what it needs with `requires` on its spec, and the runtime
resolves it against the `credentials` map. Do not add another name-keyed `Set`
in `configurationError` — the hook is for conditions a single env key cannot
express, and there is one such case left.

The Resend audience and broadcast tools are slated to move to Payload
collections; do not build new work on them.

## Shape of the API

`send_outreach_email` is the only tool that mails a person 1:1, and nothing
recalls it. Two checks stand in front of it and both fail closed: the target
page must belong to the CRM data source the caller named, and a checked
`Do Not Contact` refuses outright. Neither is advisory. Cloudflare returns
`message_id` on success, which is what lands in the row's `Last Outreach ID`.

`lib/notion-input.ts` and `lib/shared-constants.ts` are forks of `notion`'s.

## Adding a tool

New tools go in `lib/tool_defs/<bundle>/<tool>.ts`, one per file, where
`<bundle>` is the name of the skill that lists it (or `base`). Register it in
`lib/registry.ts` under `OUTREACH_TOOLS` and add its name to the skill's `tools`
array — `check:capabilities` fails if a tool is unreachable from every skill and
the base set, or if a skill names a tool that does not exist. Then run
`bun run --filter @repo/agents readmes`; the README's tables are generated and
CI fails when they are stale.
