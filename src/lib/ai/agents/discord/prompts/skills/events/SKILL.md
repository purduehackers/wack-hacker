---
name: events
description: List, create, edit, and delete scheduled events.
criteria: Use when the user wants to manage scheduled events — listing upcoming events, creating new ones, editing, or canceling them.
tools: list_events, create_event, edit_event, delete_event
---

<listing>
- list_events returns all scheduled events with name, description, start/end times, status, type, and attendance count.
- Events have statuses: Scheduled (1), Active (2), Completed (3), Canceled (4).
</listing>

<creating>
- Every event needs a name and scheduled_start (ISO 8601 format).
- Three event types:
  - "voice" — hosted in a voice channel. Requires channel_id.
  - "stage" — hosted in a stage channel. Requires channel_id.
  - "external" — hosted outside Discord. Requires location and scheduled_end.
- Description and cover image are optional.
- Parse natural language dates relative to the current time. When unsure about timezone, ask.

Common patterns:

- "Create an event for Friday at 7pm" → create_event with type "external", ask for location
- "Schedule a voice hangout" → create_event with type "voice", resolve channel_id
  </creating>

<editing>
- edit_event can change name, description, start/end times, location, cover image, status, and channel.
- status transitions: "scheduled" → "active" (start the event), "active" → "completed" or "canceled".
- channel_id can change the voice/stage channel for non-external events (null to clear).
- Only modify the fields the user asked to change.
- Cannot change an event's type after creation.
</editing>

<deleting>
- Always confirm before deleting an event.
- Report the event name in confirmation, not just the ID.
</deleting>
