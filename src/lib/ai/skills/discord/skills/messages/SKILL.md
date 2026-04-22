---
name: messages
description: Send, delete, pin/unpin messages, add reactions, and fetch message history.
criteria: Use when the user wants to send a message, delete a message, pin/unpin messages, react to messages, or read message history.
tools:
  [
    send_message,
    delete_message,
    edit_message,
    bulk_delete_messages,
    crosspost_message,
    get_message,
    pin_message,
    unpin_message,
    add_reaction,
    remove_reaction,
    remove_all_reactions,
    fetch_messages,
  ]
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

<editing>
- edit_message only works on messages the bot itself sent. Replaces content entirely.
</editing>

<bulk-delete>
- bulk_delete_messages deletes 2-100 messages at once. Messages must be <14 days old.
- Irreversible — confirm before calling.
</bulk-delete>

<crossposting>
- crosspost_message publishes an announcement-channel message to following servers.
</crossposting>

<reactions>
- add_reaction takes a Unicode emoji (e.g., "👍") or a custom emoji in `name:id` format.
- remove_reaction removes a single user's reaction (pass '@me' for the bot).
- remove_all_reactions clears every reaction on a message.
</reactions>

<fetching>
- Returns messages sorted chronologically. Use before/after for pagination.
</fetching>
