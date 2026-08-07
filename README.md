# Wack Hacker

Wack Hacker is Purdue Hackers' Discord bot and durable Eve agent.

## Gold architecture

- `packages/bot` is the only Discord principal. The long-running Bun process owns the gateway, community features, slash commands, rate limits, and all Discord REST materialization.
- `packages/agents` owns reasoning, Eve sessions, dynamic policy, tools, authorization lifecycle, and semantic desired state. Its isolated operational supervisor may receive `DISCORD_BOT_TOKEN` only to inject the bot container; Eve reasoning and domain tools never receive it or call Discord REST.
- `packages/shared` owns the strict bot↔agent wire contract, Redis/Turso adapters, Discord identifiers, typed errors, and result utilities.
- Redis is coordination truth. HTTP callbacks are wakeups only. Complete coalesced render snapshots cross the seam; token/frame forwarding does not.
- A terminal Discord render outcome (`applied` or `discarded`) is the visible-commit barrier before the next queued turn may enter Eve.
- Human-input controls use server-validated opaque locators, durable first-winner claims, interaction receipts, current Discord roles, and private TTL-bound authorization challenges.

There is no compatibility path for the serverless Workflow/Queue architecture or agent-owned Discord rendering.

The proposed simplified system diagram and module boundaries are documented in
[`docs/architecture.md`](docs/architecture.md). The evidence, refactor order,
and approval boundaries are in
[`docs/simplification-plan.md`](docs/simplification-plan.md).

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

## Vercel deployment

The Vercel project is a monorepo project rooted at `packages/agents`. Configure
it once, then deploy from the repository root so Bun can resolve
`@repo/shared`:

```bash
bunx vercel project update <project> \
  --root-directory packages/agents \
  --install-command "cd ../.. && bun install --frozen-lockfile" \
  --build-command "bun run build"
bunx vercel deploy --prod --yes
```

`eve deploy` uploads only the package directory and therefore cannot resolve the
workspace dependency in this layout. The Eve project never receives the Discord
token, `BOT_IMAGE`, or supervisor credentials.

Vercel Sandbox hosting uses a second, credential-isolated project rooted at
`packages/supervisor`. Configure its install command the same way and keep
`BOT_SANDBOX_ENABLED=false` until every bot runtime credential and a reviewed,
immutable `BOT_IMAGE` digest are present. A persistent container host does not
need this project; see `docs/operations/deployment.md`.

```bash
bunx vercel project update <supervisor-project> \
  --root-directory packages/supervisor \
  --install-command "cd ../.. && bun install --frozen-lockfile" \
  --build-command "bun run build"
bunx vercel vcr login docker
docker buildx build --platform linux/amd64 -f packages/bot/Dockerfile \
  --output "type=image,name=vcr.vercel.com/<team>/<project>/wack-hacker-bot:<tag>,push=true,oci-mediatypes=true,compression=zstd,compression-level=3,force-compression=true" .
```

Resolve the pushed tag to `@sha256:…` before configuring the supervisor's
`BOT_IMAGE`; mutable tags are rejected.

A carried-over Turso database can predate Drizzle's migration ledger even
though it already contains migrations 0000–0002. Baseline only after the script
verifies every legacy column and index, then apply the data-preserving schedule
migration:

```bash
cd packages/shared
bun run db:baseline-legacy
bun run db:migrate
```

The baseline command refuses partial history or schema drift and preserves legacy
schedule role snapshots for the immutable reshape migrations; never insert a
migration marker by hand.

## Supply-chain gate

`bun run audit` fails on every production advisory. It explicitly ignores `GHSA-67mh-4wv8-2f99`, a development-server advisory in drizzle-kit’s deprecated esbuild loader; the project neither starts that server nor includes drizzle-kit in the bot image.

## Operations

Production promotion, rollback, database change, sandbox cleanup, incident, and
supply-chain procedures live in [`docs/operations`](docs/operations/README.md).
