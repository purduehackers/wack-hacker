# Wack Hacker

Wack Hacker is Purdue Hackers' Discord bot and durable Eve agent.

## Gold architecture

- `packages/bot` owns the Discord gateway. The long-running Bun process owns community features, slash commands, HITL interaction responses, and materializing the agent's own replies — that rendering is the single writer for nonce and visible-commit convergence.
- `packages/agents` owns reasoning, Eve sessions, project policy, tools, authorization lifecycle, semantic desired state, and agent-side Turso schedule/audit/cart operations. Its Discord domain tools call Discord REST directly with the deployment's own token, exactly like every other provider domain; they never render the agent's replies.
- `packages/shared` owns strict cross-process schemas, the Redis conversation aggregate, the libSQL/Drizzle client and schema, Discord identifiers, typed errors, and result utilities; it is not a second process-composition layer.
- Bot Sandbox supervision is an Eve schedule inside `packages/agents` (`agent/schedules/bot-supervisor.ts`): it holds a Redis fence, starts a digest-pinned bot container, and rotates it before Vercel Sandbox's 24-hour cap. Persistent bot hosts do not need it — leave `BOT_SANDBOX_ENABLED=false`.
- Redis is coordination truth. Render/parked HTTP callbacks are wakeups only; the scheduled endpoint performs durable occurrence admission. Complete coalesced render snapshots cross the seam; token/frame forwarding does not.
- A terminal Discord render outcome (`applied` or `discarded`) is the visible-commit barrier before the next queued turn may enter Eve.
- Human-input controls use server-validated opaque locators, durable first-winner claims, interaction receipts, current Discord roles, and private TTL-bound authorization challenges. Authored tool approvals currently have a documented fail-closed projection limitation.

There is no compatibility path for the serverless Workflow/Queue architecture or agent-owned Discord rendering.

The current system diagram and module boundaries are documented in
[`docs/architecture.md`](docs/architecture.md). For the complete
code-derived runtime map, state machines, trust boundaries, execution traces,
and current limitations, start with
[`docs/system/README.md`](docs/system/README.md).

## Development

```bash
bun install
bun run lint
```

Run the Eve app and bot in separate terminals after filling their ignored `.env.local` files:

```bash
cd packages/agents && bun run dev
cd packages/bot && bun run dev
```

Guild commands register automatically after a merge to `main` (the
`register-commands` CI job). To register from a workstation:

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

The Eve Vercel project is rooted at `packages/agents` and is the only Vercel
project in this repository. `eve deploy` cannot resolve the monorepo's
`@repo/shared` workspace dependency, so release automation links/builds from the
repository root. Promoting a reviewed bot digest is therefore an agent
deployment: `BOT_IMAGE` is agent configuration, read only by the bot-supervisor
schedule.

The Turso schema starts from a single generated baseline migration; operators
must never insert ledger markers or run a bare migration against production.

Do not use abbreviated CLI recipes for production. Reviewed promotion, database
quiescence/PITR/verification, supervision cutover, smoke, re-enable, and rollback
steps are exclusively documented in the
[operations runbooks](docs/operations/README.md).

## Supply-chain gate

`bun audit --ignore GHSA-67mh-4wv8-2f99` gates production advisories in CI. It explicitly ignores `GHSA-67mh-4wv8-2f99`, a development-server advisory in drizzle-kit’s deprecated esbuild loader; the project neither starts that server nor includes drizzle-kit in the bot image.

## Operations

Production promotion, rollback, database change, sandbox cleanup, incident, and
supply-chain procedures live in [`docs/operations`](docs/operations/README.md).
