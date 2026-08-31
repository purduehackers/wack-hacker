# Discord and bot systems

## Discord ownership

`packages/bot` owns the single discord.js gateway client and is the only writer
of the agent's own replies. It is **not** the only Discord principal: the agent
deployment holds the same `DISCORD_BOT_TOKEN` as an optional provider credential
and calls Discord REST directly from its Discord domain tools, described under
[Discord operations](#discord-operations). Those tools are bounded by the shared
policy runtime rather than by a wire contract, and they never render agent
replies.

The bot process contains two distinct application surfaces:

1. **conversation surface** — addressed messages, placeholder/render/HITL/reset,
   covered in [Conversation engine](conversation-engine.md);
2. **community surface** — slash commands, gateway automations, and local cron.

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

## Discord operations

### Where they run

Every Discord operation the model can invoke is an ordinary domain tool in the
Discord subagent, executed against the agent deployment's own Discord REST
identity — the same shape as Linear, Notion, GitHub, or Vercel. There is no RPC
hop and no hand-written request/response contract.

```mermaid
sequenceDiagram
  participant M as Eve model
  participant T as Discord dynamic tool
  participant P as Shared policy runtime
  participant O as subagents/discord/lib/operations/*
  participant R as Discord REST

  M->>T: operation-specific input
  T->>P: approval / execute revalidation
  P->>O: tool execute(input)
  O->>R: Routes.* request with the agent's REST token
  R-->>O: Discord API value/error
  O-->>P: projected summary or typed failure
  P-->>M: plain JSON projection + audit
```

The bot keeps the Discord work only it can do: the gateway connection, community
handlers and slash commands, HITL interaction responses, and **rendering** —
`agent/render/discord-rest.ts` writing the agent's replies with nonce-enforced
idempotency. Those never crossed this seam and are unaffected.

The tradeoff taken deliberately: the renderer and the agent's message tools are
now two REST clients with independent rate-limit bucket state on the same
channel routes. Both honour `retry_after`; at this guild's volume the collision
risk is accepted in exchange for deleting the RPC layer.

### Operation modules

`subagents/discord/lib/operations/` holds the 68 operations, grouped by surface:
`members.ts`, `roles-channels.ts`, `assets.ts` (emoji/sticker/webhook),
`guild.ts` (guild/events/invites/audit/automod), and `messages.ts`
(messages/reactions/threads). Each entry is a `defineDomainTool` carrying its
`access` descriptor, so authorization, approval, budget, and audit are the
shared policy spine — identical to every other domain.

Missing configuration is declined by the runtime's `configurationError`: without
`DISCORD_BOT_TOKEN` the tools stay visible to role policy and fail closed at
execution, exactly like a missing `LINEAR_API_KEY`.

### Endpoint semantics that still matter

- Archived thread listing requires a channel. It follows public, private, and
  joined-private routes with each route's native cursor, deduplicates IDs, caps
  traversal, and rejects missing/nonadvancing cursors instead of returning a
  partial list.
- Sticker creation downloads bounded media, preserves the 512 KiB limit, and
  assigns correct PNG/APNG/GIF/Lottie filenames. Editing distinguishes omitted
  description from explicit `null`.
- Role-position tools summarize the role returned by Discord's position update,
  not a guessed local value.
- Real timestamp fields use ISO schemas. Provider-owned automod nested JSON
  remains explicitly pass-through where the public wire already requires it.
- Webhook results never project credentials/tokens.

### Model-controlled media fetch

Emoji, sticker, role-icon, webhook-avatar, and scheduled-event image operations
take an `httpUrl` the model supplies. `operations/common.ts::download()` rejects
embedded credentials and non-HTTP(S) schemes, follows redirects, times out after
15 seconds, checks the MIME type, and enforces both the declared `Content-Length`
and the actual byte length. It has **no host or private-IP allowlist**, and
without `Content-Length` the body is fully buffered by `arrayBuffer()` before the
actual-size rejection can fire.

These operations declare `risk: "write"`, whose default confirmation is `none`,
so there is no per-URL human gate: the only gate is the organizer-only Discord
subagent descriptor. Moving the operations out of the bot did not shrink this
surface — it moved the fetch into the agent process, which holds every provider
credential rather than only the Discord token. This is a described limitation,
not a claim that it is desirable.

## Slash command system

Commands are built at startup, but registration is never a boot side effect. It
is a standalone script, `packages/bot/scripts/register-commands.ts`, run by the
`register-commands` CI job after a merge to `main` and available to an operator
directly:

```bash
cd packages/bot
CONFIRM_COMMAND_GUILD=772576325897945119 bun run register-commands
```

Registration PUTs exactly `/ping`, `/privacy`, `/hack-night`, and `/image-drop`
to the fixed guild and refuses a mismatched confirmation guild, so the CI job cannot reach a
different guild even with a misconfigured secret. The PUT replaces the whole
command set, which is what makes repeating it on every merge safe.

### Common interaction dispatch

```text
Discord InteractionCreate
└─ dispatchInteraction()
   ├─ HITL handler first
   ├─ autocomplete → instrument(command.autocomplete) → respond(choices)
   ├─ ignore other non-chat-input
   ├─ SET bot:interaction:<id> NX EX 86400
   ├─ find command by registered name
   └─ trace + instrument(command.run)
      └─ reply/defer/edit/followUp
```

Autocomplete deliberately skips the interaction claim: Discord sends one per
keystroke, each already unique, so a claim would be a Redis write per character
to deduplicate nothing. It also has no failure notice — an autocomplete has no
channel to speak on, and leaving the typed text alone is the correct outcome for
an option that accepts free text anyway.

A Redis claim outage fails closed with an ephemeral temporary-unavailable
message. A duplicate is silently ignored because the winner should reply.
Unknown command skew is an invariant defect. All handler failures receive a
generic ephemeral error; typed details remain in telemetry.

### `/ping`

Public health check. It reports elapsed time since the interaction snowflake's
creation and rounded gateway ping. A malformed/nonpositive snowflake still
reports gateway ping.

### `/privacy`

Self-scoped, always ephemeral. One toggle — `view`, `opt-out`, `opt-in` —
stored as a Redis set of opted-out user ids (`@repo/shared/privacy`).

The user id always comes from the interaction, never from an option, so the
command cannot read or change anyone else's setting and needs no role gate.

Enforcement is local and lives at the three publish points, each checking
`isOptedOut` before it uploads: `emit-ship-message`, `emit-dashboard-message`,
and `image-drops`. Opting out is forward-looking — it stops future
uploads and does not delete what is already public.

### `/hack-night`

Current organizer/admin only, always ephemeral:

- `start` validates one Extended_Pictographic code point and a version, renames
  the fixed channel's leading emoji, then updates Dashboard Global Config;
- `reset` restores the moon prefix and does not change dashboard version.

Discord rename precedes Global Config update. A partial failure may leave the
channel renamed; rerunning is the convergence path.

`start` also takes an optional `event`, the slug of a CMS event, autocompleted
from the [event directory](#event-directory). Both lookups it
needs — the event, and the newest active `Hack Night Images` thread — run before
the rename, so an unknown slug or a missing thread rejects the whole command with
a specific ephemeral answer and no side effects. Linking then rewrites the
thread's drop record _additively_: the night keeps the batch it already had, so a
link made mid-night does not split the archive, and photos already filed under
that batch are attached to the event in one read-modify-write. A CMS that refuses
`events.images[]` is reported in the reply rather than failing the command.

### `/image-drop`

Organizer/admin only, ephemeral, one required `event` slug, autocompleted from
the [event directory](#event-directory). It reads the event
from the CMS first, then posts an announcement in the invoking channel, opens a
one-week `Image Drop — <event name>` thread on it, and records the drop as
`batchId = <event slug>`, `source = discord-drop`. If the record cannot be
stored, the thread and announcement are deleted — a drop thread with no record
ignores every upload, which is indistinguishable from a working one until someone
checks the CMS.

Opening a drop is gated; posting into one is not. A wrong slug, a channel that
cannot hold a thread, and a CMS that refuses to read events are all answered
ephemerally rather than raised, because the dispatcher renders a raised failure as
a generic "Something went wrong".

### Event directory

Both `event` options suggest from one cached list of CMS events, ranked against
what has been typed: prefix matches first, then word-boundary matches, then
substrings, each group most-recent-first. An empty query — the option focused
before anything is typed — answers with the most recent events. Choices read as
`<name> — <date>`, marked `(draft)` when the CMS says the event is unpublished,
and carry the slug as their value.

Three layers keep the CMS off a path Discord abandons after three seconds: an
in-process memo (60s) that absorbs a burst of keystrokes, `cms:events:v1` in
Redis (10 minutes) so a restart or a second instance starts warm, and the CMS
itself under a two-second budget with a 30-second cooldown after a failure. One
refresh serves a whole burst of keystrokes, and a keystroke waits at most 1.2s
on it before answering with what it already has — a cold cache answers the next
keystroke instead of missing the deadline on this one. A failed refresh serves
the last good list; a cold one serves nothing and the option still accepts free
text.

Suggestions are organizer-gated even though the commands are visible to
everyone: an unpublished event is a plan, and the CMS's event list is not
public. A non-organizer gets an empty list rather than an error.

Staleness is the trade for that budget. An event created a minute ago may not be
suggested yet, which is exactly why these are autocomplete options rather than
fixed choices — a hand-typed slug is still accepted, and both commands resolve it
against the CMS rather than against the cache.

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

### Image drop upload/removal

A thread is a drop when `image-drop:<threadId>` holds a record. The weekly photo
thread is the one exception: any public or private thread whose parent is fixed
#hack-night and whose name begins `Hack Night Images` also resolves, falling back
to a date-derived batch when the record is gone. No other thread is ever filed on
a guess.

A direct image attachment in a drop thread is deduplicated by
`(source, batch, message, filename)` through Payload, then downloaded and
uploaded sequentially. When the drop names a CMS event, each upload is also
appended to that event's `images[]`. The handler reacts ✅ if every image was
filed or ❌ if any failed.

`events.images[]` is a whole-array write, so appends are serialized per event
in-process and verified after the write; a lost update raises `Transient` and is
retried. A 403 there is a permission fact rather than a failure: the photo stays
archived under its batch, the reaction stays ✅, and the thread gets one Redis-
claimed notice telling an editor to bulk-attach from the media library.

On ❌ reaction, the original author or a freshly resolved organizer/admin may
bulk-delete Payload media for that Discord message; the removed ids are then
detached from the linked event. The bot clears its own ✅ reaction after removal.
Per-attachment CMS failures are represented principally by the visible ❌; the
outer handler currently returns an instrumented success.

### Voice transcription

A Discord voice message with a `.ogg` attachment reacts 🎙️, downloads audio,
and uses Groq `whisper-large-v3-turbo` in English. Small files try whole-audio first;
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
thread, then stores `image-drop:<threadId>` as an unlinked hack-night drop
batched `hack-night-YYYY-MM-DD` for thirty days. Completed Discord effects are not rolled back if a later step fails.

### Friday 23:58 — Lightning Time countdown

Posts a two-minute warning and edits it through 16 charge boundaries plus
midnight using DST-safe absolute Indiana instants. Three `/users/@me` probes
estimate median REST latency so edits are sent slightly early. Individual frame
edit failures warn and continue; initial setup failure ends the job.

### Sunday 18:00 — cleanup

Chooses the first thread-bearing message from the latest ten hack-night channel
messages, resolves the stored drop or Friday fallback, lists CMS images, posts a
total/top-five contributor summary when nonempty, then archives and locks the
thread. A CMS/send failure before the final step prevents archive on that run.

## Community integrations

| Service                 | Data/behavior                                                                             | Failure/timeout notes                                                |
| ----------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Privacy DB              | Self preference CRUD                                                                      | Typed retries for rate/5xx/transport; no explicit fetch timeout      |
| Dashboard Global Config | Hack-night version                                                                        | Parsed at startup; typed retry; no explicit fetch timeout            |
| Dashboard message API   | Public message identity/content/HTML/attachments                                          | All non-2xx currently treated transient; no explicit timeout         |
| Ships                   | User/message/title/content/media metadata                                                 | Upstream message ID idempotence; rate/5xx retry; no explicit timeout |
| Payload CMS             | Drop media binary + source/batch/message/user metadata, and the linked event's `images[]` | 15s requests; 2,000-document listing cap; uploads not shared-retried |
| Groq                    | Raw Discord voice audio/transcript                                                        | Whole-file size fallback; chunk retry once                           |

## Current behavior and limitations

These details matter when diagnosing effects:

- The gateway router has no fixed-guild guard; exclusive installation is assumed.
- Event and bot-local schedule dedup claims occur before filters/work and are not
  released on failure.
- Community sibling handlers are concurrent. A deleted noncompliant ship post
  can race with dashboard publication.
- Dashboard and ships do not synchronize edits; dashboard does not synchronize
  deletion.
- `/privacy` is forward-looking only: opting out stops future uploads and
  does not retract anything already published.
- A prior reaction by the same user/message can suppress photo ❌ removal for
  five minutes because that handler's dedup key omits emoji.
- Payload attachment errors are collapsed into an outer success plus ❌ signal.
- Photography/cleanup select records by broad recent-name/thread heuristics.
- Missing post-midnight drop record can split Saturday uploads from Friday's
  archive batch.
- Event attach serialization is in-process only, so two overlapping deployments
  can still contend for `events.images[]`; the write is verified and retried
  rather than locked across processes.
- Several provider/CDN requests have no common deadline; CMS is the consistent
  timeout exception. Voice attachment download buffers the whole Discord CDN
  response before applying the 24 MiB whole-vs-chunk decision.
- A second process signal can cut short the first graceful drain because the
  shutdown operation is idempotent and the wrapper then exits.

These are descriptions of the current implementation, not promises that the
limitations are desirable.

## Parity

- the operation modules preserve nested malformed-data handling, stickers, role
  positions, legacy routes and archive pagination;
- the Discord operation modules project every response explicitly, so provider
  output contracts are visible in the source rather than inferred;
- `bun run check:capabilities` in `packages/agents` proves the exact 68-key registry.
