# Runtime map

## Repository and process boundaries

Wack Hacker is a Bun monorepo with four workspaces. The package boundary is also
a security and ownership boundary; it is not just source organization.

| Workspace             | Runtime                       |             Long-lived? | Owns                                                                                                                       | Must not own                                        |
| --------------------- | ----------------------------- | ----------------------: | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `packages/bot`        | Bun + discord.js              |                     Yes | Discord gateway, Discord REST, HTTP callbacks, rendering, slash commands, community handlers, bot-local cron               | Eve state, Turso, provider-domain policy            |
| `packages/agents`     | Eve 0.29.5 application        | Session/server lifetime | Model sessions, channel state, subagents, tools, skills, policy, approvals, durable schedule dispatch                      | Discord bot token, discord.js, direct Discord REST  |
| `packages/shared`     | Imported library/scripts      |                      No | Cross-process validation contracts, Redis client and conversation transitions, Drizzle schema, shared error/result helpers | Process composition or hidden ambient configuration |
| `packages/supervisor` | Vercel function/control plane |          Per invocation | Fenced Vercel Sandbox creation, health gating, generation handoff and cleanup                                              | Discord behavior, reasoning, conversation state     |

The bot and Eve app can run on any reachable hosts. `packages/supervisor` is
needed only when the bot uses Vercel Sandbox's maximum-24-hour containers. A
persistent container platform replaces that control plane with its own restart
and health policy.

## Dependency direction

```mermaid
flowchart TD
  Bot[packages/bot] --> Shared[packages/shared]
  Agents[packages/agents] --> Shared
  Supervisor[packages/supervisor] --> Shared
  Shared --> Upstash[@upstash/redis]
  Shared --> LibSQL[@libsql/client + Drizzle]
  Bot --> DiscordJS[discord.js + @discordjs/rest]
  Bot --> Bun[Bun.serve and Bun runtime]
  Agents --> Eve[Eve]
  Agents --> AI[AI SDK / Vercel AI Gateway]
  Agents --> Providers[provider SDKs and HTTP APIs]
  Supervisor --> VercelSandbox[@vercel/sandbox]
```

There are no imports from `bot` into `agents` or the reverse. Their only direct
application seam is authenticated HTTP whose bodies are decoded by
`packages/shared/src/wire.ts` and
`packages/shared/src/discord-command-wire.ts`. Both may independently import the
same `ConversationStore`; this does not create a second state-machine owner
because all keys and Lua live in `packages/shared/src/conversations`.

## Technology stack

| Layer                   | Technology                                                     | How it is used                                                                                                          |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Runtime/package manager | Bun                                                            | Bot runtime, tests, scripts, workspace install, formatting/lint/build entrypoints                                       |
| Agent framework         | Eve 0.29.5                                                     | Sessions, custom channel, state, lifecycle events, dynamic subagents/skills/tools, approval hooks, schedules            |
| Agent sandbox           | Eve `defaultBackend()` or pinned Vercel backend                | Per-session shell/filesystem for built-in tools; code subagent uses an explicit one-vCPU allowlisted Vercel Sandbox     |
| Models                  | AI SDK through Vercel AI Gateway                               | Root agent defaults to `anthropic/claude-sonnet-5`; Eve owns message/tool execution                                     |
| Discord                 | discord.js and `@discordjs/rest`                               | Gateway objects in the bot; narrow raw REST calls for semantic RPC and renderer                                         |
| Coordination            | Upstash Redis                                                  | Conversation aggregate, leases, receipts, budgets, approval records, event dedup, active bot generation                 |
| Relational data         | Turso/libSQL + Drizzle                                         | Schedules, application-append-only action audit, global shopping cart                                                   |
| Policy                  | Verdex plus project adapters                                   | Fail-closed role/risk/confirmation decisions; surrounding code owns current authority, persistence, audit and execution |
| Validation              | Zod plus narrow manual/derived decoders                        | Project-owned HTTP/Redis/libSQL/provider shapes; strictness is boundary-specific and outputs derive from owners         |
| Expected failures       | Better Result plus project tagged errors                       | Typed expected-error paths without serializing `Result` objects across processes                                        |
| Scheduling              | Eve schedules + Croner                                         | Durable agent schedule dispatcher and bot-local community schedules                                                     |
| Hosting                 | Vercel for Eve; Vercel Sandbox or persistent container for bot | Credential-isolated deployments; digest-pinned optional Sandbox rotation                                                |
| Telemetry               | OpenTelemetry + Sentry + structured reporter events            | Trace propagation across Redis/HTTP, defects, wide events, user support references                                      |
| Quality gates           | TypeScript, Oxfmt, Oxlint, Bun test, Turbo                     | Format, type/parity/serialization, lint, package and real-Redis tests                                                   |

## Trust boundaries

### Discord to bot

Discord gateway events and interactions become discord.js objects. The bot is the
only process with `DISCORD_BOT_TOKEN`. Gateway role IDs and Discord identifiers
are treated as observations, not lasting authorization decisions.

### Bot to Eve

The bot sends `Authorization: Bearer AGENT_INGRESS_SECRET`. The custom channel in
`packages/agents/agent/channels/discord.ts` compares it with the shared
constant-time bearer helper and strictly decodes the body. The bot asserts:

- Discord user ID and names;
- raw current role snowflakes;
- parent channel and optional thread;
- message, dispatch, schedule and occurrence identifiers;
- a W3C `traceparent` when available.

`authFor()` converts that assertion to Eve `SessionAuthContext`. Policy later
calls `requirePrincipal()`, where current raw Discord roles override any asserted
role tier. Missing/unknown roles resolve downward to `public`. The bearer authenticates the
bot service, not Discord cryptographic evidence inside each body; anyone holding
it can assert an arbitrary user and raw-role list. Keeping that secret bot-only
is therefore load-bearing.

### Eve to bot

The agent sends `Authorization: Bearer BOT_INGRESS_SECRET` to:

- render and parked wake routes, plus scheduled occurrence admission, in
  `packages/bot/src/framework/server.ts`;
- the strict Discord semantic command route in
  `packages/bot/src/agent/discord-commands/route.ts`.

The bot decodes every body before side effects. Render and parked callbacks are
only wake hints; Redis is reread. Discord command requests are semantic RPCs and
are decoded again on the response path by the agent. That bearer is likewise
service-wide authority for the 68-operation allowlist: the bot does not receive
or repeat end-user RBAC, so policy must already have run in Eve.

### Agent to providers

Each provider domain has a small adapter around its native SDK or HTTP API. Tool
discovery is based on role policy, not credential presence. Missing provider
configuration becomes a typed execution-time `UpstreamError`, which keeps Eve
catalog reconstruction deterministic while still failing closed at use time.

### Redis generation record to agent HTTP

Source code assigns the active-generation key to the supervisor, but Redis does
not mechanically enforce that writer ownership. Its schema accepts any HTTPS
origin with exact `/health`; the agent derives a base URL from it and presents
the service-wide bot bearer. A valid-looking poisoned record is therefore a
confused-deputy/credential-exfiltration path. All Redis writers and credentials
belong inside this trust boundary.

### Supervisor to bot container

Only the supervisor deployment receives the full bot environment needed to
inject a candidate container. The Eve deployment never receives the Discord
bot token, bot image, or Sandbox management credentials. The configured image
must end in an immutable lowercase `@sha256:<64 hex>` digest.

## Configuration ownership

Environment schemas use `@t3-oss/env-core`, treat empty strings as missing, and
allow `SKIP_ENV_VALIDATION=1` only for tooling that imports modules without
running production behavior.

### Bot (`packages/bot/src/env.ts`)

Required groups:

- Discord: `DISCORD_BOT_TOKEN`, `DISCORD_BOT_CLIENT_ID`;
- agent seam: `AGENT_URL`, `AGENT_INGRESS_SECRET`, `BOT_INGRESS_SECRET`;
- Redis: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`;
- community integrations: privacy DB, Vercel/Edge Config dashboard, Payload CMS,
  ship mirror, dashboard API, and Groq credentials;
- `PORT` (default `8080`), with optional `SENTRY_DSN`.

It intentionally has no Turso variables.

### Agents (`packages/agents/agent/lib/env.ts`)

Required groups:

- bot seam: `AGENT_INGRESS_SECRET`, `BOT_URL`, `BOT_INGRESS_SECRET`;
- Turso: `TURSO_DATABASE_URL`, optional `TURSO_AUTH_TOKEN`;
- Redis REST URL/token.

Provider credentials and Sentry tuning are optional at boot. Their individual
tools report configuration failures at execution.

### Supervisor (`packages/supervisor/src/env.ts`)

Always requires the cron bearer and Redis. When
`BOT_SANDBOX_ENABLED=true`, it also requires a digest-pinned `BOT_IMAGE` and the
full bot process environment. Vercel SDK credentials are either all supplied
(`VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`) or all omitted so project
OIDC can be used.

## Bot startup and shutdown

The composition root is `packages/bot/src/index.ts::main()`.

```text
main()
├─ installSignalHandlers()
├─ register Sentry shutdown callback
├─ createClient()
├─ buildCommands()
├─ getRedis() + createConversationStore()
├─ createConversationSeam()
│  ├─ createAgentClient()
│  ├─ createDiscordRest()
│  ├─ createConversationFlow()
│  └─ createHitlInteractionHandler() + interaction listener
├─ startServer()                         # binds before Discord login
├─ connect(client)                       # await ready or exit
├─ flow.start()                          # startup recovery before admissions
├─ buildEventHandlers() + attachEventRouter()
├─ buildSchedules() + startScheduler()
└─ operationalReady = true
```

`/health` therefore returns a structured 503 during login and recovery rather
than refusing connections or claiming false readiness. Event handlers and local
schedules attach only after `Client<true>` exists. Shutdown callbacks run in
reverse registration order so new work stops and Discord paint drains while the
gateway REST token is still usable; Sentry flushes last.

## Eve application lifecycle

`packages/agents/agent/agent.ts` defines the root agent:

- model: `anthropic/claude-sonnet-5`;
- compaction at 80% context;
- two-hour session timeout;
- 500,000 input and 50,000 output tokens per session.

Eve discovers the custom Discord channel, root tools, 13 subagents, native
skills/tools, hooks, and the schedule from filesystem conventions. The channel
uses Discord `continuationKey` as Eve's continuation token. On each delivery Eve
refreshes `session.auth.current`, while the session and channel state remain
durable according to Eve's backend.

Eve `defaultBackend()` remains the framework owner for ordinary session sandbox
materialization. The default harness gives root and non-code agents sandbox
`bash`/file/search tools plus app/provider web tools unless each slug is
overridden or disabled; the project currently leaves that broad default surface
in place. Sandbox app environment is not forwarded, but default network egress
is `allow-all`. The code subagent instead pins an empty-env, one-vCPU Vercel
Sandbox, an allowlisted network policy, and bounded replacements for the generic
tools. The just-bash backend is a command-execution fallback inside Eve's
sandbox lifecycle, not bot hosting or an independent lifecycle replacement.

## Source-of-truth matrix

| Data                                     | Authority                           | Cache/snapshot behavior                                                                      |
| ---------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| Discord members/roles/channels/messages  | Discord                             | Ordinary turns use a gateway role snapshot; HITL/reset/scheduled-agent paths target-refresh  |
| Eve conversation/model state             | Eve backend                         | Resumed by continuation token                                                                |
| Pending/active conversation state        | Redis conversation aggregate        | No host-local fallback                                                                       |
| Desired and applied Discord render state | Redis intent/projection/outcome     | Bot process may work locally only while holding a render claim                               |
| HITL/interaction/scheduled-fire receipts | Redis                               | TTL-bound idempotency records                                                                |
| Tool approval policy                     | Redis                               | Bound to session/call/requester/tool/risk and later reread                                   |
| Public-user token budget                 | Redis                               | Sole fail-open dimension inside project policy; Eve default tools bypass that policy         |
| Scheduled tasks                          | Turso                               | Agent actions narrowly fallback to creation roles; direct message actions do no role refresh |
| Action history                           | Turso application-append-only audit | Audit append failure is reported but cannot replay/undo a completed provider action          |
| Shopping cart                            | Turso                               | One global cart row plus unique `(cart_id, asin)` items                                      |
| Active bot Sandbox generation            | Redis `wack:bot-sandbox:active:v1`  | Required fields validated/canonicalized; additive fields are ignored                         |
| Bot host container filesystem            | Nothing durable                     | Disposable and never restored as application truth                                           |
| Eve session workspace                    | Eve sandbox backend                 | Persists/resumes across turns for that session; reset creates a fresh sandbox                |

## Development commands

From the repository root:

```bash
bun install
bun run validate
bun run test:contracts:docker
bun run build
bun run audit
```

Run the two application runtimes separately:

```bash
cd packages/agents && bun run dev
cd packages/bot && bun run dev
```

The package scripts intentionally hide framework-specific launch details. Use
Bun-facing repository commands rather than inventing a second test/build path.
