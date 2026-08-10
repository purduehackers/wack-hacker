# `cloudflare` — notes for adding a tool here

Written for whoever extends this domain, not for the agent that runs it. Runtime
guidance belongs in `instructions.md` and `lib/skill_defs/*.md`; this is what the
upstream API does and where it will surprise you.

## Upstream

`cloudflare` 7.0.0 (`lib/client.ts`), authenticated with `CLOUDFLARE_API_TOKEN`
and scoped per call by `CLOUDFLARE_ACCOUNT_ID`. DNS and Email Routing are
zone-scoped; Email Sending is account-scoped except its `subdomains` resource,
which is zone-scoped — the account path 404s.

Vercel-style naming drift: the product is Global Config but ids still carry the
`ecfg_` prefix, and the SDK exposes `edgeConfig` with `*EdgeConfig*` methods.
Those are upstream identifiers and stay.

## Shape of the API

The SDK maps create/get/update/delete for Email Routing rules but **not** list,
so `list_routing_rules` goes through the generic `client.get()` and parses the
response with zod at the boundary rather than asserting a shape.

`dns.records.create` is a 21-member union discriminated on `type`, several
members needing structured `data` instead of a string. This domain narrows to
the six types that carry a plain `content`. Cloudflare's `edit` endpoint still
requires `name`, `ttl` and `type`, which is why there is no separate patch tool.

`emailSending.send` returns `permanent_bounces` inside a 2xx body — a caller
that only checks for a thrown error records a dead address as delivered.

## Adding a tool

New tools go in `lib/tool_defs/<bundle>/<tool>.ts`, one per file, where
`<bundle>` is the name of the skill that lists it (or `base`). Register it in
`lib/registry.ts` under `CLOUDFLARE_TOOLS` and add its name to the skill's `tools`
array — `check:capabilities` fails if a tool is unreachable from every skill and
the base set, or if a skill names a tool that does not exist. Then run
`bun run --filter @repo/agents readmes`; the README's tables are generated and
CI fails when they are stale.
