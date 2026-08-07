---
name: threads
description: List, create, edit, and delete threads in channels.
criteria: Use when the user wants to manage threads — listing, creating, editing, or deleting threads.
tools: [list_threads, create_thread, edit_thread, delete_thread]
minRole: organizer
mode: inline
---

<listing>
- Returns active threads by default. Set include_archived for archived threads.
- Can scope server-wide or to a specific channel.
</listing>

<creating>
- Standalone: provide channel_id and name.
- From a message: also provide message_id.
- Types: public (default) or private.
- Auto-archive options: 60, 1440, 4320, 10080 minutes.
- Cannot create threads inside other threads.
</creating>

<editing>
- Can modify name, archived, locked, auto-archive duration, slowmode, invitable.
- Archiving hides from active list but doesn't delete. Can be unarchived later.
</editing>

<deleting>
- Always confirm. Thread deletion is irreversible and removes all messages.
</deleting>
