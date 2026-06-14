# CLAUDE.md

Wack Hacker is an AI-powered Discord bot for Purdue Hackers: a Next.js App Router +
Hono app on Vercel, built on the AI SDK v6 and the Workflow DevKit, with an orchestrator
that delegates to role-gated subagents.

## Start here

- `docs/architecture.md` — how the bot is wired (gateway → router → orchestrator → subagents).
- `docs/agents/` — the agent runtime: `adding-tools.md`, `orchestrator.md`, `subagents.md`, `policy.md`, `roles.md`, `approvals.md`, `streaming.md`, `context.md`, `code-sandbox.md`.
- `docs/skills/` — the skill system (`SKILL.md` format, progressive disclosure, registry).
- `docs/testing.md` — test layout, fixtures, and coverage expectations.

## Before you commit

```bash
bun run validate   # typecheck + lint + test
```

In a fresh worktree, run `bun scripts/compile-skills.ts` **before** `typecheck` —
the skills registry, delegate docs, and context-inspector tables are generated,
and typecheck fails against stale output.

## Style is enforced, not described

Naming, file organization, imports, and dead-code are checked by tooling — read
the configs, don't restate them here:

- `.oxlintrc.json` — `@factory/*` rules enforce file organization (`types.ts`,
  `constants.ts`, `enums.ts`, `errors.ts`, test location) and ban exported
  string-union types and exported function expressions. `oxclippy` flags
  complexity. Run `bun run lint`.
- `.oxfmtrc.json` — formatting + import grouping. Run `bun run format`.
- `knip.json` — dead-code detection. Run `bun run knip`.

The shape that follows from those: kebab-case filenames, `interface` for
structural types and `type` for unions, per-module `types.ts` / `constants.ts`,
avoid `as` casts, colocated `*.test.ts` with shared fixtures in `src/lib/test/`.

## Conventions tooling can't catch

- **Mark unavoidable hacks** with `// HACK: <reason>` (setTimeouts, ordering
  workarounds, anything surprising). Nothing else needs a comment.
- **Constants carry units**: suffix numeric constants with `_MS`, `_BYTES`,
  `_CHARS`, etc. (e.g. `MAX_LEADIN_BLOCK_CHARS`). Keep them in the module's
  `constants.ts`.
- **Dispatch on typed discriminants**, never on `error.message.includes(...)`.
  Errors are domain-local classes (see `src/lib/audio/errors.ts`,
  `src/lib/tasks/queue/errors.ts`) — branch on the class/tag.
- **One wide event per unit of work** for telemetry — `src/lib/logging/wide.ts`
  (`.set({...})` then `.emit({ status, duration_ms })`), not a scatter of narrow
  logs. `trace.id` is injected automatically for Sentry linkage.

## Changing the public surface

Adding or changing a tool, a slash command, an `access.risk` level, or a role
gate changes what users can do. Follow `docs/agents/adding-tools.md`: author with
`defineTool({ name, domain, description, access, input, execute })`, declare
`access` (the `access-coverage` test fails any tool without it), and add a test.
The drift tests (`delegates.test.ts`, `coverage-manifest.test.ts`) guard the rest.
