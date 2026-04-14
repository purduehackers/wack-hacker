---
name: initiatives
description: Create/update initiatives; query initiative activity and history.
criteria: Use when the user wants to create/update an initiative or inspect its history.
tools: [create_initiative, update_initiative, list_initiatives, query_initiative_activity]
minRole: organizer
mode: inline
---

Initiatives group projects under strategic goals.

<creating_updating>

- Only set fields explicitly provided. Don't guess owner, target dates, or narrative content.
- Status values: "Planned", "Active", "Completed".
  </creating_updating>

<activity>
- Use history for "when did it become Active / who changed owner?"
- Supports pagination and date ranges.
</activity>
