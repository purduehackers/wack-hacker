# AgentContext

`src/lib/ai/context.ts` defines `AgentContext`, the immutable carrier of execution context that every agent run needs.

## Fields

| Field                              | Source                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `userId`, `username`, `nickname`   | The Discord member who triggered the turn                                                             |
| `channel`, `thread?`               | Where the conversation lives                                                                          |
| `date`                             | Pre-formatted current date string (e.g. `"Wednesday, April 15, 2026"`)                                |
| `attachments?`                     | Any files on the triggering message                                                                   |
| `memberRoles?`                     | Discord role IDs from the member object                                                               |

`role: UserRole` is a **getter** (not a stored field) that resolves at access time by checking `memberRoles` against the `ROLE_IDS` constant defined inside `context.ts` itself: admin first, then organizer, falling back to public. See [Role-based access](./roles.md).

## Construction

Two constructors:

- **`AgentContext.fromPacket(packet)`** — build from a fresh `MessageCreatePacketType`. This is the hot path: mention handler calls it, then `.toJSON()`s the result into the `chatWorkflow` payload.
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

Substitutes `{{DATE}}` in the base prompt and appends an `<execution_context>` block containing the user, channel, optional thread, and date as YAML. The orchestrator is the only direct caller today — the subagent system prompt comes from a different path (the domain `SKILL.md` body, via `createDelegationTool`).

Example of what gets appended:

```xml
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
```
