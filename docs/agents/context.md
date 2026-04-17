# AgentContext

`src/lib/ai/context.ts` defines `AgentContext`, the immutable carrier of per-turn execution state. It pairs with a workflow-owned `messages` array to give the model both environmental context (who/where/when) and real conversation history.

## Data model

There are three distinct pieces of state a chat workflow carries:

```
┌─ Initial payload (ChatPayload) ────────────────────────────┐
│  channelId  :  string    where the bot replies             │
│  content    :  string    first user message                │
│  context    :  SerializedAgentContext ─── see below        │
└────────────────────────────────────────────────────────────┘

┌─ SerializedAgentContext ───────────────────────────────────┐
│  STABLE ─ pinned at workflow start, never mutates:         │
│    • channel         : ChannelInfo                         │
│    • thread?         : ThreadInfo                          │
│    • recentMessages? : RecentMessage[]                     │
│                        ↑ channel/thread history LEADING IN │
│                        to the conversation. Does NOT flip  │
│                        to conversation history over time.  │
│                                                            │
│  FRESH PER TURN ─ rebuilt from each triggering packet:     │
│    • userId / username / nickname   (this turn's sender)   │
│    • memberRoles?                   (this turn's roles)    │
│    • attachments?                   (this turn's files)    │
│    • date                           (now())                │
└────────────────────────────────────────────────────────────┘

┌─ Workflow-local messages array ────────────────────────────┐
│  ChatMessage[] accumulated across hook resumes:            │
│    [ { role: "user",      content: "remind me friday" },   │
│      { role: "assistant", content: "what time?" },         │
│      { role: "user",      content: "any time works" },     │
│      { role: "assistant", content: "scheduled." } ]        │
│                                                            │
│  Lives in chatWorkflow's local state. Vercel WDK's durable │
│  replay reconstructs it from memoized step results.        │
└────────────────────────────────────────────────────────────┘
```

### Why the split

Conflating "channel lead-in" with "bot conversation history" forces a choice between two bad options: either the lead-in messages pollute later turns (stale channel chatter treated as conversation), or the conversation history gets scraped from Discord each turn (fragile, tops out at 15 messages, loses tool-call reasoning).

Splitting them gives each piece one clear job:

- **`recentMessages`** is a snapshot of the channel at the moment the workflow started. It tells the model "here's what was happening before I got mentioned." It never updates — if it did, it would flip from lead-in to transcript.
- **`messages`** is the actual turn-by-turn conversation, passed to `agent.stream({ messages })` as proper user/assistant roles. Grows by two entries per turn.

## Fields

| Field                            | Stable / Fresh | Source                                                                 |
| -------------------------------- | -------------- | ---------------------------------------------------------------------- |
| `userId`, `username`, `nickname` | fresh          | The Discord member who triggered the current turn                      |
| `channel`, `thread?`             | stable         | Where the conversation lives (pinned when workflow starts)             |
| `date`                           | fresh          | Pre-formatted current date string (e.g. `"Wednesday, April 15, 2026"`) |
| `attachments?`                   | fresh          | Files on the current turn's message                                    |
| `memberRoles?`                   | fresh          | Discord role IDs for the current sender                                |
| `recentMessages?`                | stable         | Last ~15 channel/thread messages before the workflow started           |

`role: UserRole` is a **getter** (not a stored field) that resolves at access time by checking `memberRoles` against the `ROLE_IDS` constant defined inside `context.ts`: admin first, then organizer, falling back to public. Because `memberRoles` is fresh per turn, `role` correctly reflects the current sender — a follow-up from a different user is evaluated against their own roles, not the original author's. See [Role-based access](./roles.md).

## Construction

Two constructors:

- **`AgentContext.fromPacket(packet, options?)`** — build from a `MessageCreatePacketType`. Options:
  - `threadOverride: { id, name }` — supply when a thread was just created for this mention. The packet still describes the parent channel; pass the new thread and `channel`/`thread` on the resulting context will reflect the thread instead.
  - `recentMessages: RecentMessage[]` — attach the lead-in block fetched separately (only meaningful on workflow start; follow-up hook resumes omit this).
- **`AgentContext.fromJSON(serialized)`** — rebuild from a `SerializedAgentContext`. Used at the top of `streamTurn` to rehydrate context inside a workflow step, and by `taskWorkflow.executeAction` to fabricate a synthetic context for scheduled agent tasks.

The constructor is private; you can only go through these two paths.

## Serialization

```ts
toJSON(): SerializedAgentContext
```

Returns the raw shape: every field as plain data, no methods. This is what gets embedded in `ChatPayload` and passed across workflow suspensions. Because workflows can outlive a deploy, this serialized form has to be stable — changing `SerializedAgentContext` is a breaking change to in-flight conversations.

## Building instructions

```ts
buildInstructions(baseInstructions: string): string
```

Substitutes `{{DATE}}` in the base prompt and appends an `<execution_context>` block plus (if set) a `<recent_thread_messages>` or `<recent_channel_messages>` block with the lead-in. The orchestrator is the only direct caller today.

Example of what gets appended:

````xml
<execution_context>
```yaml
user:
  username: "rayhan"
  nickname: "Rayhan"
  id: "123456789"
channel:
  name: "#bot-testing"
  id: "987654321"
thread:
  name: "Rayhan — help me debug this"
  id: "555555555"
  parent_channel: "#bot-testing"
date: "Wednesday, April 15, 2026"
```
</execution_context>

<recent_thread_messages>
[1:17 PM] ray: earlier channel chatter
[1:17 PM] someone-else: more lead-in context
</recent_thread_messages>
````

The `recent_*_messages` block is the **lead-in only** — conversation turns between the user and the bot are delivered separately as `messages: [{role, content}, ...]` on the `agent.stream()` call, not as scraped text inside the system prompt.
