---
name: scheduling
description: Schedule one-time or recurring tasks (messages or agent prompts)
criteria: When the user wants reminders, scheduled messages, or recurring automated tasks
tools:
  - scheduleTask
  - listScheduledTasks
  - cancelTask
minRole: public
mode: inline
---

## Scheduling Guidelines

- For reminders and static announcements, use action_type "message".
- For dynamic content (e.g. "summarize this week's activity"), use action_type "agent".
- Always confirm the schedule with the user before creating it.
- Use the channel ID from the execution context as the default target.
- Use the requesting user's ID from the execution context.
- Recurring tasks use 5-field cron expressions: minute hour day month weekday.
