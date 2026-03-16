---
name: messages
description: Send, delete, pin/unpin messages, add reactions, and fetch message history.
criteria: Use when the user wants to send a message, delete a message, pin/unpin messages, react to messages, or read message history from a channel.
tools: send_message, delete_message, pin_message, unpin_message, add_reaction, fetch_messages
---

<sending>
- Resolve the channel name to an ID via list_channels before sending.
- Message content supports Discord markdown — follow the `<discord_markdown>` section in the system prompt for supported syntax.
- Messages are limited to 2000 characters.
- Don't embed Discord metadata (thread URLs, internal IDs) in message content.
</sending>

<deleting>
- Requires both channel_id and message_id.
- Use fetch_messages to find the message ID if the user describes it by content or author.
- Message deletion is irreversible — confirm if the context is ambiguous.
</deleting>

<pinning>
- pin_message and unpin_message require channel_id and message_id.
- Channels have a max of 50 pinned messages.
- Use fetch_messages to find the message ID if needed.
</pinning>

<reactions>
- add_reaction takes a Unicode emoji (e.g., "👍") or a custom emoji ID.
- For custom server emojis, use the format `name:id` (e.g., `purduepete:123456789`).
</reactions>

<fetching>
- fetch_messages returns messages sorted chronologically.
- Use before/after parameters for pagination through older messages.
- Each message includes author, content, timestamp, pinned status, and attachments.
</fetching>
