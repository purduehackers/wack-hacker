---
name: initiatives
description: Create/update initiatives; query initiative activity/history.
criteria: Use when the user wants to create/update an initiative or inspect its history.
tools: create_initiative, update_initiative, list_initiatives, query_initiative_activity
---

Initiatives group projects under strategic goals.

<creating_updating>

- Only set fields explicitly provided; don't guess owner, target dates, or narrative content.
- Change only what the user asked for when updating (name/description/content/owner/status/target date).
- Status values: "Planned", "Active", "Completed".
- Parent/child structure is only used if enabled; don't assume it.
  </creating_updating>

<activity>
- Use history for "when did it become Active / who changed owner?"
- Use updates for progress narratives over time.
- Supports pagination and date ranges.
</activity>
