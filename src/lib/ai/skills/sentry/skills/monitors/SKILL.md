---
name: monitors
description: Manage cron monitors — view schedules, check-in history, and configure runtime limits.
criteria: Use when the user asks about cron jobs, scheduled tasks, monitors, missed check-ins, or job failures.
tools: [list_monitors, get_monitor, list_monitor_checkins, update_monitor, delete_monitor]
minRole: organizer
mode: inline
---

<monitors>
- list_monitors shows all cron monitors with their schedule and status.
- Status: "ok", "missed_checkin", "error", "disabled", "active".
- Schedule types: "crontab" (e.g., "0 * * * *") or "interval" (e.g., every 10 minutes).
</monitors>

<checkins>
- list_monitor_checkins shows the history of check-ins for a monitor.
- Check-in statuses: "ok", "missed_checkin", "error", "in_progress", "timeout".
- Duration shows how long the job ran (null if missed).
</checkins>

<updating>
- update_monitor can change the name, schedule, margins, and runtime limits.
- checkin_margin: minutes of grace before marking a check-in as missed.
- max_runtime: minutes before a running check-in is marked as failed.
</updating>

<deleting>
- delete_monitor is irreversible. Requires explicit user intent.
</deleting>
