---
name: cycles
description: List, create, update, and archive Linear cycles (sprints).
criteria: Use when the user wants to manage Linear cycles — creating a new sprint, updating dates, or archiving an old cycle.
tools: [list_cycles, get_cycle, create_cycle, update_cycle, archive_cycle]
minRole: organizer
mode: inline
---

- Cycles are per-team; always provide team_id on create.
- Dates are ISO 8601 (e.g. '2026-05-01T00:00:00.000Z').
- Linear does not support hard-deleting cycles — archive instead.
- progress is a 0-1 completion ratio based on issue status.
