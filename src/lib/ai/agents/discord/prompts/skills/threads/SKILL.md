---
name: threads
description: List, create, edit, and delete threads in channels.
criteria: Use when the user wants to manage threads — listing active/archived threads, creating new threads, editing thread settings, or deleting threads.
tools: list_threads, create_thread, edit_thread, delete_thread
---

<listing>
- list_threads returns active threads by default. Set include_archived to true to also see archived threads.
- Can list threads server-wide (omit channel_id) or scoped to a specific channel.
- Thread data includes name, parent channel, archived/locked status, message count, and member count.
</listing>

<creating>
- Two ways to create a thread:
  - **Standalone**: Provide channel_id and name. Creates a new thread without an originating message.
  - **From a message**: Also provide message_id. Creates a thread starting from that message.
- Thread types: public (default) or private. Private threads are only visible to invited members and those with Manage Threads permission.
- Auto-archive options: 60 (1 hour), 1440 (1 day), 4320 (3 days), 10080 (7 days).
- slowmode sets the initial slowmode delay in seconds.
- invitable controls whether non-moderators can invite others (private threads only).
- Cannot create threads inside other threads.

Common patterns:

- "Create a thread in #general" → list_channels to find general's ID, create_thread with channel_id
- "Start a thread from this message" → create_thread with channel_id and message_id
- "Create a private thread" → create_thread with type "private"
- "Create a private thread only mods can invite to" → create_thread with type "private" and invitable false
  </creating>

<editing>
- Use edit_thread to modify name, archived status, locked status, auto-archive duration, slowmode, or invitable.
- Archiving a thread hides it from the active list but doesn't delete it. It can be unarchived later.
- Locking a thread prevents non-moderators from unarchiving it.
- invitable controls whether non-moderators can invite others (private threads only).
- Only modify the fields the user asked to change.
</editing>

<deleting>
- Always confirm with the user before deleting. Thread deletion is irreversible and removes all messages in it.
- Report the thread name in confirmation, never just the ID.
</deleting>
