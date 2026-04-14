---
name: messages
description: Send, delete, pin/unpin messages, add reactions, and fetch message history.
criteria: Use when the user wants to send a message, delete a message, pin/unpin messages, react to messages, or read message history.
tools: [send_message, delete_message, pin_message, unpin_message, add_reaction, fetch_messages]
minRole: organizer
mode: inline
---

<sending>
- Resolve the channel name to an ID via list_channels before sending.
- Messages are limited to 2000 characters.
- Don't embed Discord metadata in message content.
</sending>

<deleting>
- Requires both channel_id and message_id.
- Use fetch_messages to find the message ID if described by content or author.
- Message deletion is irreversible — confirm if context is ambiguous.
</deleting>

<pinning>
- Requires channel_id and message_id. Channels have a max of 50 pinned messages.
</pinning>

<reactions>
- add_reaction takes a Unicode emoji (e.g., "👍") or a custom emoji in `name:id` format.
</reactions>

<fetching>
- Returns messages sorted chronologically. Use before/after for pagination.
</fetching>
