---
name: issues
description: Search, inspect, resolve, and manage Sentry issues — view events, stack traces, and tags.
criteria: Use when the user wants to search errors, view issue details, inspect stack traces, resolve/ignore issues, or assign issues.
tools:
  [
    update_sentry_issue,
    delete_sentry_issue,
    list_sentry_issue_events,
    get_sentry_event,
    list_sentry_issue_tags,
  ]
minRole: organizer
mode: inline
---

<searching>
- Use `search_sentry_issues` (always available) to find issues by query.
- Sentry search syntax: `is:unresolved`, `assigned:me`, `level:error`, `first-release:1.0.0`, or free-text keywords.
- Sort by `date` (last seen), `new` (first seen), `freq` (event count), or `priority`.
</searching>

<inspecting>
- Use `get_sentry_issue` for metadata, stats, and tags overview.
- Use `list_sentry_issue_events` to see individual occurrences.
- Use `get_sentry_event` with the project slug and event ID for the full stack trace, breadcrumbs, and context.
- Use `list_sentry_issue_tags` to see tag distributions (browser, OS, URL, etc.).
</inspecting>

<updating>
- Use `update_sentry_issue` to resolve, ignore, unressolve, assign, or change priority.
- To archive: set status to "ignored" with a substatus like "archived_until_escalating".
- To unassign: set assignedTo to an empty string.
</updating>

<deleting>
- `delete_sentry_issue` permanently removes an issue — confirm with the user first.
- Admin role required.
</deleting>
