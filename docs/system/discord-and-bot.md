# Discord and bot systems

## Discord ownership

`packages/bot` is the only Discord principal. It holds the bot token, owns the
single discord.js gateway client, and performs every Discord REST effect. The
Eve application can request only one of the strict semantic operations described
below; it cannot send an arbitrary route, method, body, webhook credential, or
Discord token.

The same bot process contains three distinct application surfaces:

1. **conversation surface** — addressed messages, placeholder/render/HITL/reset,
   covered in [Conversation engine](conversation-engine.md);
2. **semantic Discord RPC** — agent tools to allowlisted raw REST operations;
3. **community surface** — slash commands, gateway automations, and local cron.

They share the Discord client and telemetry, not authorization or state machines.

## Gateway configuration

`framework/gateway.ts` creates a client with intents:

- Guilds;
- GuildMessages;
- privileged MessageContent;
- GuildMessageReactions.

Partials are Message, Reaction, and Channel. There is no DM or GuildMembers
intent; handlers that need a member role refresh use targeted REST fetches.
Presence is online/watching. discord.js supplies the WebSocket identity, current
gateway state, and its rate-limit-aware REST manager.

The application is designed for the fixed Purdue Hackers guild
`772576325897945119`. Slash commands are registered only there. The generic
gateway router does not itself reject other guild IDs, so exclusive bot
installation is an operational privacy boundary for otherwise unscoped handlers.

## Event router

`attachEventRouter()` attaches MessageCreate, MessageDelete,
MessageReactionAdd, and MessageReactionRemove. `InteractionCreate` is attached
separately for HITL and slash commands.

### Addressing and ordering

A message addresses Eve only when:

- `<@bot>` or `<@!bot>` starts the content; or
- it replies to a bot message inside a thread.

Derived `mention` handlers run to completion before ordinary `message` handlers.
Ordinary handlers receive `isBotMention=true` and can skip agent-directed text.
Within either group, sibling handlers run concurrently with `Promise.all`.
Different gateway events are also concurrent because discord.js does not await
listeners.

Bot-authored messages and bot reactors are dropped. Deletes are not
sender-filtered. Partials are not force-fetched by the router; individual
handlers decide if they need current data. There are currently no
reaction-remove or message-update behaviors.

### Handler-level deduplication

Before filtering or side effects, each handler claims:

```text
dedup:<handlerName>:<eventKey> = 1, NX, PX 300000
```

The handler name scopes the claim so sibling behaviors each see the same event.
Five minutes covers gateway RESUME replay and brief deployment overlap. Redis
failure fails closed and skips side effects. Claims are not released when a
handler later fails, so the bias is at-most-once for five minutes rather than an
event retry queue.

Every executed handler is wrapped by `instrument()`. Expected typed errors are
counted/logged; invariant/untyped defects also reach Sentry. One sibling's
failure cannot cancel another.

## Semantic Discord command RPC

### End-to-end path

```mermaid
sequenceDiagram
  participant M as Eve model
  participant T as Discord dynamic tool
  participant P as Shared policy runtime
  participant C as Agent Discord client
  participant B as Bot HTTP route
  participant H as Exhaustive handler
  participant R as Discord REST

  M->>T: operation-specific input
  T->>P: approval / execute revalidation
  P->>C: discordCommand(operation, parsed input)
  C->>B: POST /internal/discord-command + bearer
  B->>B: ready check + strict union decode
  B->>H: executeDiscordCommand(rest, command)
  H->>R: allowlisted Routes.* request
  R-->>H: Discord API value/error
  H-->>B: strict semantic summary
  B-->>C: strict success/failure envelope
  C->>C: envelope + operation output decode
  C-->>P: typed Result
  P-->>M: plain JSON projection + audit
```

### Agent client

`subagents/discord/lib/client.ts::createDiscordCommandClient()`:

- resolves the current bot base URL from the active generation record or
  configured fallback;
- POSTs `{ operation, input }` with `BOT_INGRESS_SECRET`;
- applies a 30-second timeout;
- strictly decodes the response envelope even on non-2xx;
- maps 429 to `RateLimited`, 5xx/transport to `Transient`, and provider 4xx to
  `UpstreamError`;
- strictly decodes `data` with the schema for the exact operation;
- maps malformed HTTP-200 success to a 502 upstream failure.

### Bot route

`agent/discord-commands/route.ts::handleDiscordCommandRequest()`:

1. requires POST;
2. constant-time bearer check;
3. rejects while the gateway is not ready;
4. decodes the strict discriminated operation union;
5. calls the handler with `client.rest`;
6. returns a bounded strict success/error envelope.

The route normalizes invalid upstream statuses to 502 and never exposes a raw
exception or REST object.

### Handler boundary

`DiscordRest` is derived as the narrow raw-method subset of discord.js client
REST: `delete`, `get`, `patch`, `post`, and `put`. The exhaustive switch uses
`discord-api-types` request/response types and `Routes.*`; it does not use
manager caches or entity semantics.

Static Discord types are not runtime validation. The handler therefore:

- checks objects/arrays and required nested fields fail-closed;
- projects provider-owned values to small project summaries;
- validates the final operation-specific output schema;
- ends the switch exhaustively (`command satisfies never`).

Input schema keys, output schema keys, `DISCORD_TOOLS`, the agent registry, and
bot switch are checked for exact 68-operation parity.

### Operation inventory

| Capability group     | Exact operations                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core read operations | `get_server_info`, `list_channels`, `list_roles`, `search_members`                                                                                                                                                        |
| Audit log            | `get_audit_log`                                                                                                                                                                                                           |
| Auto moderation      | `list_auto_mod_rules`, `get_auto_mod_rule`, `create_auto_mod_rule`, `update_auto_mod_rule`, `delete_auto_mod_rule`                                                                                                        |
| Channels             | `create_channel`, `edit_channel`, `delete_channel`, `get_channel`, `follow_announcement_channel`                                                                                                                          |
| Emoji/stickers       | `list_emojis`, `create_emoji`, `edit_emoji`, `delete_emoji`, `list_stickers`, `create_sticker`, `edit_sticker`, `delete_sticker`                                                                                          |
| Scheduled events     | `list_events`, `create_event`, `edit_event`, `delete_event`                                                                                                                                                               |
| Guild                | `update_guild`, `get_guild_preview`, `get_vanity_url`                                                                                                                                                                     |
| Invites              | `list_invites`, `create_invite`, `delete_invite`                                                                                                                                                                          |
| Member moderation    | `ban_member`, `unban_member`, `list_bans`, `kick_member`, `timeout_member`, `clear_timeout`                                                                                                                               |
| Members              | `get_member`, `set_nickname`                                                                                                                                                                                              |
| Membership           | `add_member_to_platform`, `remove_member_from_platform`                                                                                                                                                                   |
| Messages             | `send_message`, `delete_message`, `edit_message`, `bulk_delete_messages`, `crosspost_message`, `get_message`, `pin_message`, `unpin_message`, `add_reaction`, `remove_reaction`, `remove_all_reactions`, `fetch_messages` |
| Roles                | `create_role`, `edit_role`, `delete_role`, `assign_role`, `remove_role`                                                                                                                                                   |
| Threads              | `list_threads`, `create_thread`, `edit_thread`, `delete_thread`                                                                                                                                                           |
| Webhooks             | `list_webhooks`, `create_webhook`, `delete_webhook`, `edit_webhook`                                                                                                                                                       |

### Important endpoint semantics

- Archived thread listing requires a channel. It follows public, private, and
  joined-private routes with each route's native cursor, deduplicates IDs, caps
  traversal, and rejects missing/nonadvancing cursors instead of returning a
  partial list.
- Sticker creation downloads bounded media, preserves the 512 KiB limit, and
  assigns correct PNG/APNG/GIF/Lottie filenames. Editing distinguishes omitted
  description from explicit `null`.
- Role-position tools summarize the role returned by Discord's position update,
  not a guessed local value.
- Real timestamp fields use ISO schemas. The legacy snowflake-valued
  `createdAt` compatibility fields and provider-owned automod nested JSON remain
  explicitly pass-through where the public wire already requires it.
- Webhook results never project credentials/tokens.
- Emoji/event/role/webhook/sticker media URLs may name arbitrary HTTP(S)
  hosts. The fetch follows redirects and has a 15-second timeout, MIME checks,
  and operation-specific declared/actual byte bounds, but no host/private-IP
  allowlist. Without `Content-Length`, `arrayBuffer()` buffers the body before
  the actual-size rejection. Several URL-taking operations are write-risk and
  therefore default to no confirmation; the model controls the URL after the
  organizer-only outer Discord subagent gate. This is a no-HITL SSRF/GET-side-
  effect and potentially unbounded-memory surface in the process holding all bot
  credentials.

## Slash command system

Commands are built at startup but guild registration is an explicit operator
command, not an automatic boot side effect:

```bash
cd packages/bot
CONFIRM_COMMAND_GUILD=772576325897945119 bun run register-commands
```

Registration PUTs exactly `/ping`, `/privacy`, and `/hack-night` to the fixed
guild and refuses a mismatched confirmation guild.

### Common interaction dispatch

```text
Discord InteractionCreate
└─ dispatchInteraction()
   ├─ HITL handler first
   ├─ ignore non-chat-input
   ├─ SET bot:interaction:<id> NX EX 86400
   ├─ find command by registered name
   └─ trace + instrument(command.run)
      └─ reply/defer/edit/followUp
```

A Redis claim outage fails closed with an ephemeral temporary-unavailable
message. A duplicate is silently ignored because the winner should reply.
Unknown command skew is an invariant defect. All handler failures receive a
generic ephemeral error; typed details remain in telemetry.

### `/ping`

Public health check. It reports elapsed time since the interaction snowflake's
creation and rounded gateway ping. A malformed/nonpositive snowflake still
reports gateway ping.

### `/privacy`

Self-scoped, always ephemeral, backed by `pdb.purduehackers.com`:

- `view` — global preference and project overrides;
- `set` — `opt_in`, `opt_out_privacy`, or destructive
  `opt_out_collection`, with optional reason;
- `set-project` — override `commit-overflow` or `ships`;
- `reset` / `reset-project` — return to default/global behavior.

Inputs and provider responses are Zod-validated. The bot is only the preference
management UI: its local dashboard/ship handlers do not read these preferences;
downstream services own enforcement.

### `/hack-night`

Current organizer/admin only, always ephemeral:

- `start` validates one Extended_Pictographic code point and a version, renames
  the fixed channel's leading emoji, then updates Dashboard Edge Config;
- `reset` restores the moon prefix and does not change dashboard version.

Discord rename precedes Edge Config update. A partial failure may leave the
channel renamed; rerunning is the convergence path.

## Community message and reaction handlers

### `praise`

A non-agent guild message containing flexible/case-insensitive
`wackity hackity praise me` grants the WACKY role and reacts 🥳;
`wackity hackity go away` removes it and reacts 🤐. WACKY is celebratory state,
not an authorization tier.

### Agent-reply feedback

A reaction on a seven-day `turn-message` index entry emits an `ai.feedback`
telemetry event joined to the Eve session/turn. 👍, ❤️, 🔥, 💯, and ✅ are
positive; 👎 and ❌ are negative; every other named emoji is recorded as unknown.
The per-handler dedup key includes message, reactor, and emoji. Feedback neither
resumes Eve nor changes conversation state.

### `auto-thread`

For fixed #ship and #checkpoints, a post shows work when direct/forwarded text
contains a URL or direct/forwarded attachments exist.

- compliant: create a `<displayName> - <first 54 chars>` thread, three-day
  archive; WACKY members also receive ordered reactions and a celebration;
- noncompliant: copy, delete, then best-effort DM the author a saved copy and
  instructions.

Sibling community handlers are concurrent, so deletion is not an ordered gate
before external mirroring.

### Ship mirror

`emit-ship-message` folds direct/forwarded text, projects image/video media, and
POSTs a stable message-ID record to `ships.purduehackers.com`. MessageDelete
removes it; 404 is a normal no-op. There is no edit synchronization.

Eligibility is URL in folded text or at least one _direct_ attachment. A
forwarded attachment alone satisfies auto-thread but not ship mirror eligibility
unless forwarded text also has a URL. This is current behavior.

### Dashboard mirror

For non-agent public messages, `emit-dashboard-message`:

1. requires a guild and rejects private threads;
2. resolves parent/category;
3. excludes four fixed internal categories;
4. requires @everyone ViewChannel;
5. renders Discord markdown to HTML with REST-backed mention resolution;
6. POSTs raw markdown, HTML, author/channel/time, and attachment URLs to the
   Purdue Hackers dashboard API.

Uncertain category/permission fails closed. Mention resolution failures degrade
the rendered mention rather than aborting the whole mirror. There are no edit or
delete mirror handlers.

### Hack-night photo upload/removal

A direct image attachment is archived when the message is in any public or
private thread whose parent is fixed #hack-night and whose name begins
`Hack Night Images`. The handler resolves a Redis event slug (or date fallback),
deduplicates each `(source, batch, message, filename)` through Payload, downloads
and uploads sequentially, then reacts ✅ if every image succeeded or ❌ if any
failed.

On ❌ reaction, the original author or a freshly resolved organizer/admin may
bulk-delete Payload media for that Discord message. The bot clears its own ✅
reaction after removal. Per-attachment CMS failures are represented principally
by the visible ❌; the outer handler currently returns an instrumented success.

### Voice transcription

A Discord voice message with a `.ogg` attachment reacts 🎙️, downloads audio,
and uses Groq `whisper-large-v3` in English. Small files try whole-audio first;
size-class failures or files over 24 MiB use Ogg Opus chunks near 20 MiB.

`splitOggOpus()` preserves headers, sequence numbers, EOS bits and CRC. At most
10 chunks transcribe concurrently with one local retry. Partial output keeps
order with failure markers; long replies split under 1,900 characters. The first
message is a reply and subsequent pieces are ordinary channel messages.

## Bot-local schedules

These are Croner jobs inside the bot and are different from user-created durable
agent schedules. Every nominal Indiana-time occurrence claims:

```text
bot:schedule:<name>:<YYYYMMDDHHmm> = 1, NX, EX 14 days
```

`protect:true` blocks one process from overlapping itself. Claims survive body
failure, there is no catch-up/retry queue, and the next cron time is a different
key.

### Friday 20:00 — photography thread

Posts and pins a random hack-night greeting, removes one recent pin system
notice, starts `Hack Night Images - MM/DD`, pings the hack-night role in the
thread, then stores `hack-night-thread:<threadId> = hack-night-YYYY-MM-DD` for
seven days. Completed Discord effects are not rolled back if a later step fails.

### Friday 23:58 — Lightning Time countdown

Posts a two-minute warning and edits it through 16 charge boundaries plus
midnight using DST-safe absolute Indiana instants. Three `/users/@me` probes
estimate median REST latency so edits are sent slightly early. Individual frame
edit failures warn and continue; initial setup failure ends the job.

### Sunday 18:00 — cleanup

Chooses the first thread-bearing message from the latest ten hack-night channel
messages, resolves the stored slug or Friday fallback, lists CMS images, posts a
total/top-five contributor summary when nonempty, then archives and locks the
thread. A CMS/send failure before the final step prevents archive on that run.

## Community integrations

| Service               | Data/behavior                                                | Failure/timeout notes                                                |
| --------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Privacy DB            | Self preference CRUD                                         | Typed retries for rate/5xx/transport; no explicit fetch timeout      |
| Dashboard Edge Config | Hack-night version                                           | Parsed at startup; typed retry; no explicit fetch timeout            |
| Dashboard message API | Public message identity/content/HTML/attachments             | All non-2xx currently treated transient; no explicit timeout         |
| Ships                 | User/message/title/content/media metadata                    | Upstream message ID idempotence; rate/5xx retry; no explicit timeout |
| Payload CMS           | Hack-night media binary + source/batch/message/user metadata | 15s requests; 2,000-document listing cap; uploads not shared-retried |
| Groq                  | Raw Discord voice audio/transcript                           | Whole-file size fallback; chunk retry once                           |

## Current behavior and limitations

These details matter when diagnosing effects:

- The gateway router has no fixed-guild guard; exclusive installation is assumed.
- Event and bot-local schedule dedup claims occur before filters/work and are not
  released on failure.
- Community sibling handlers are concurrent. A deleted noncompliant ship post
  can race with dashboard publication.
- Dashboard and ships do not synchronize edits; dashboard does not synchronize
  deletion.
- Local mirror handlers do not query `/privacy` preferences.
- A prior reaction by the same user/message can suppress photo ❌ removal for
  five minutes because that handler's dedup key omits emoji.
- Payload attachment errors are collapsed into an outer success plus ❌ signal.
- Photography/cleanup select records by broad recent-name/thread heuristics.
- Missing post-midnight slug mapping can split Saturday uploads from Friday's
  archive batch.
- Several provider/CDN requests have no common deadline; CMS is the consistent
  timeout exception. Voice attachment download buffers the whole Discord CDN
  response before applying the 24 MiB whole-vs-chunk decision.
- A second process signal can cut short the first graceful drain because the
  shutdown operation is idempotent and the wrapper then exits.

These are descriptions of the current implementation, not promises that the
limitations are desirable.

## Tests and parity

- `framework/events.test.ts`, `dedup.test.ts`, `server.test.ts` characterize
  routing/order/dedup/HTTP;
- `framework/observability.test.ts` characterizes metrics/defect accounting;
- command/event unit tests cover authorization and provider projections;
- `agent/discord-commands/handler.test.ts` covers nested malformed data,
  stickers, role positions, legacy routes and archive pagination;
- `shared/src/discord-command-wire.test.ts` proves strict operation output
  contracts;
- agent feature-parity and tool-policy tests prove the exact 68-key registry.
