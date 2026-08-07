---
name: replays
description: View session replays — user session recordings with error context.
criteria: Use when the user asks about session replays, user recordings, or wants to see what a user experienced.
tools: [list_replays, get_replay]
minRole: organizer
mode: inline
---

<replays>
- list_replays returns session recordings with duration, error count, and user info.
- Filter by user email, error count, duration, or activity level.
- Sort by started_at, duration, or count_errors.
- Default time range is 7 days.
</replays>

<details>
- get_replay returns full details for a single replay.
- Includes URLs visited, browser/OS info, segment count, and error count.
- Replay IDs are UUIDs.
</details>
