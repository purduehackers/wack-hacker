# `cms` — notes for adding a tool here

Written for whoever extends this domain, not for the agent that runs it. Runtime
guidance belongs in `instructions.md` and `lib/skill_defs/*.md`; this is what the
upstream API does and where it will surprise you.

## Upstream

Payload REST at `https://cms.purduehackers.com`, authenticated as a
`service-accounts` collection user with `PAYLOAD_CMS_API_KEY`.

`lib/client.ts` is 435 lines because it carries the zod document schemas, not
just an HTTP handle. Payload assigns numeric ids on Postgres and string ids on
Mongo and both reach us on the wire, so ids are `z.union([z.string(), z.number()])`.

## Shape of the API

Sending is a **flag, not a call**. `send_blast` and `send_email` set
`send: true` and Payload's own `afterChange` hook dispatches the mail, then
resets the flag. The send therefore happens in the Payload deployment, not here,
which means this repo cannot retry it, observe it, or cancel it.

`publish_*` and `unpublish_*` change what the public site shows immediately.
Unpublishing is the only undo.

## Adding a tool

New tools go in `lib/tool_defs/<bundle>/<tool>.ts`, one per file, where
`<bundle>` is the name of the skill that lists it (or `base`). Register it in
`lib/registry.ts` under `CMS_TOOLS` and add its name to the skill's `tools`
array — `check:capabilities` fails if a tool is unreachable from every skill and
the base set, or if a skill names a tool that does not exist. Then run
`bun run --filter @repo/agents readmes`; the README's tables are generated and
CI fails when they are stale.
