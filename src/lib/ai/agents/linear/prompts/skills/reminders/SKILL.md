---
name: reminders
description: Set a reminder for the current user on an issue, document, project, or initiative.
criteria: Use when the user wants to set a reminder or be nudged about something.
tools: set_reminder
---

<time_handling>

- Absolute date -> triggers at 9am in user's timezone.
- Absolute datetime -> triggers at that exact time.
- Duration ("in 2 hours") -> triggers relative to now.
- Next weekday/week -> triggers next occurrence at 9am.
  </time_handling>

<behavior>
- Only for the current user (can't set for teammates).
- One reminder per entity; setting a new one replaces the old.
- Search for the target entity first via search_entities.
</behavior>

<alternative>
- For deadline-based reminders, use update_issue with dueDate instead.
</alternative>
