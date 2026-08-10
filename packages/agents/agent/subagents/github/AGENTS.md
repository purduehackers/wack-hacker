# `github` — notes for adding a tool here

Written for whoever extends this domain, not for the agent that runs it. Runtime
guidance belongs in `instructions.md` and `lib/skill_defs/*.md`; this is what the
upstream API does and where it will surprise you.

## Upstream

`octokit` with `@octokit/auth-app` — a GitHub App install, not a PAT
(`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`),
scoped to `GITHUB_ORG`.

This is one of three domains wiring `provider-redaction` into its runtime, and
its audit hook sets `redactInput: true`. Tool output passes through
`projectProviderOutput` and errors through `redactProviderText`; a new tool
returning raw octokit JSON inherits that, but do not defeat it by stringifying
early.

## Shape of the API

`set_branch_protection` replaces the whole rule set. Every rule omitted from the
call is sent as an explicit clear rather than left alone, so a partial update
silently removes protections.

`delete_repository` destroys code, issues and history with no restore, and
`transfer_repository` moves a repository out of the org, after which none of
these tools can reach it.

Octokit responses are untyped JSON at the boundary. Search results in
particular return label entries that may be strings or objects — narrow before
reading, do not assume.

## Adding a tool

New tools go in `lib/tool_defs/<bundle>/<tool>.ts`, one per file, where
`<bundle>` is the name of the skill that lists it (or `base`). Register it in
`lib/registry.ts` under `GITHUB_TOOLS` and add its name to the skill's `tools`
array — `check:capabilities` fails if a tool is unreachable from every skill and
the base set, or if a skill names a tool that does not exist. Then run
`bun run --filter @repo/agents readmes`; the README's tables are generated and
CI fails when they are stale.
