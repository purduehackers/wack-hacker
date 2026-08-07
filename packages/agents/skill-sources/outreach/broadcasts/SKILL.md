---
name: broadcasts
description: Manage Resend broadcasts — mass email campaigns to audiences.
criteria: Use when the user wants to create, schedule, send, or delete a Resend broadcast.
tools: [list_broadcasts, get_broadcast, create_broadcast, send_broadcast, delete_broadcast]
minRole: organizer
mode: inline
---

- Broadcasts target a Resend audience (segment). Use the audiences skill to pick one first.
- create_broadcast creates a draft. send_broadcast dispatches it.
- scheduled_at accepts ISO 8601 or natural language ("in 1 hour").
- delete_broadcast only works on drafts — sent broadcasts are permanent.
- The from address must be on a verified domain (see domains skill).
