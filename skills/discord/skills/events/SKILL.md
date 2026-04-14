---
name: events
description: List, create, edit, and delete scheduled events.
criteria: Use when the user wants to manage scheduled events — listing upcoming events, creating new ones, editing, or canceling them.
tools: [list_events, create_event, edit_event, delete_event]
minRole: organizer
mode: inline
---

<creating>
- Every event needs a name and scheduled_start (ISO 8601).
- Three types: "voice" (requires channel_id), "stage" (requires channel_id), "external" (requires location and scheduled_end).
- Parse natural language dates relative to current time. When unsure about timezone, ask.
</creating>

<editing>
- Can change name, description, start/end times, location, cover image, status, and channel.
- Status transitions: "scheduled" -> "active" -> "completed" or "canceled".
- Cannot change event type after creation.
</editing>

<deleting>
- Always confirm before deleting an event.
</deleting>
