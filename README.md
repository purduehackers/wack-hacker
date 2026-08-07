# Wack Hacker

Wack Hacker is Purdue Hackers' Discord bot and durable Eve agent.

## Gold architecture

- `packages/bot` is the only Discord principal. The long-running Bun process owns the gateway, community features, slash commands, rate limits, and all Discord REST materialization.
- `packages/agents` owns reasoning, Eve sessions, project policy, tools, authorization lifecycle, semantic desired state, and agent-side Turso schedule/audit/cart operations. Eve reasoning and domain tools never receive the Discord token or call raw Discord REST.
- `packages/shared` owns strict cross-process schemas, the Redis conversation aggregate, the libSQL/Drizzle client and schema, Discord identifiers, typed errors, and result utilities; it is not a second process-composition layer.
- `packages/supervisor` is a separate optional, credential-isolated control plane. Only that deployment may receive `DISCORD_BOT_TOKEN` to inject a bot container; persistent bot hosts do not need it.
- Redis is coordination truth. Render/parked HTTP callbacks are wakeups only; the scheduled endpoint performs durable occurrence admission. Complete coalesced render snapshots cross the seam; token/frame forwarding does not.
- A terminal Discord render outcome (`applied` or `discarded`) is the visible-commit barrier before the next queued turn may enter Eve.
- Human-input controls use server-validated opaque locators, durable first-winner claims, interaction receipts, current Discord roles, and private TTL-bound authorization challenges. Authored tool approvals currently have a documented fail-closed projection limitation.

There is no compatibility path for the serverless Workflow/Queue architecture or agent-owned Discord rendering.

The current system diagram and module boundaries are documented in
[`docs/architecture.md`](docs/architecture.md). The evidence, refactor order,
and approval boundaries are in
[`docs/simplification-plan.md`](docs/simplification-plan.md). For the complete
code-derived runtime map, state machines, trust boundaries, execution traces,
and current limitations, start with
[`docs/system/README.md`](docs/system/README.md).

## Development

```bash
bun install
bun run validate
```

Run the Eve app and bot in separate terminals after filling their ignored `.env.local` files:

```bash
cd packages/agents && bun run dev
cd packages/bot && bun run dev
```

Register the three guild-scoped commands explicitly:

```bash
cd packages/bot && CONFIRM_COMMAND_GUILD=772576325897945119 bun run register-commands
```

## Container

The bot image is host-agnostic. Build from the repository root so the shared workspace is in context:

```bash
docker build -f packages/bot/Dockerfile -t wack-hacker-bot .
docker run --env-file packages/bot/.env.local -p 8080:8080 wack-hacker-bot
```

Vercel Sandbox is the primary host; the same image can run on any persistent container host.

## Production deployment and database changes

The Eve Vercel project is rooted at `packages/agents`; the optional,
credential-isolated bot supervisor project is rooted at `packages/supervisor`.
`eve deploy` cannot resolve the monorepo's `@repo/shared` workspace dependency,
so release automation links/builds from the repository root. The Eve project
never receives the Discord token, bot image, or supervisor credentials.

A carried-over Turso database may contain migrations 0000–0002 without a
Drizzle ledger. Its guarded baseline verifies the exact legacy schema and stages
role evidence before writing history; operators must never insert ledger markers
or run a bare migration against production.

Do not use abbreviated CLI recipes for production. Reviewed promotion, database
quiescence/PITR/verification, supervisor cutover, smoke, re-enable, and rollback
steps are exclusively documented in the
[operations runbooks](docs/operations/README.md).

## Supply-chain gate

`bun run audit` fails on every production advisory. It explicitly ignores `GHSA-67mh-4wv8-2f99`, a development-server advisory in drizzle-kit’s deprecated esbuild loader; the project neither starts that server nor includes drizzle-kit in the bot image.

## Operations

Production promotion, rollback, database change, sandbox cleanup, incident, and
supply-chain procedures live in [`docs/operations`](docs/operations/README.md).
