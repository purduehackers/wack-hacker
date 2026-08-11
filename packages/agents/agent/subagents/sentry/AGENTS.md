# `sentry` — notes for adding a tool here

Written for whoever extends this domain, not for the agent that runs it. Runtime
guidance belongs in `instructions.md` and `lib/skill_defs/*.md`; this is what the
upstream API does and where it will surprise you.

## Upstream

`@sentry/api` with `SENTRY_API_TOKEN`, scoped to `SENTRY_ORG`. Not
`SENTRY_AUTH_TOKEN` — that is the Vercel integration's release-upload token and
carries only `project:read`/`project:releases`/`project:write`, so every tool
here that reads an event or an issue gets a 403 from it. This one needs
`event:read` and `org:read`. Calls return a
wrapped result — `unwrapResult` before use.

One of three domains wiring `provider-redaction`, with `redactInput: true` on
its audit hook.

## Shape of the API

**Destructive operations here fail quietly.** Nothing errors when monitoring
stops; the dashboards simply go calm, and calm is indistinguishable from
healthy. `delete_project_key` retires a DSN that deployed SDKs are still using,
so events stop arriving from code nobody touched. `delete_alert_rule` and
`delete_monitor` leave the service running and unwatched. Each is noticed at the
next incident, not at the time of the change — so a tool here should report what
it silenced, not just that it succeeded.

`bulk_update_issues` applies one status change across an arbitrary list in a
single call, which turns a wrong query into a wrong mass edit.

A member id is not an email address; resolve with `list_members` first.

## Adding a tool

New tools go in `lib/tool_defs/<bundle>/<tool>.ts`, one per file, where
`<bundle>` is the name of the skill that lists it (or `base`). Register it in
`lib/registry.ts` under `SENTRY_TOOLS` and add its name to the skill's `tools`
array — `check:capabilities` fails if a tool is unreachable from every skill and
the base set, or if a skill names a tool that does not exist. Then run
`bun run --filter @repo/agents readmes`; the README's tables are generated and
CI fails when they are stale.
