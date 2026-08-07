---
name: events
description: List and inspect error events, stack traces, and breadcrumbs.
criteria: Use when the user wants to see error details, stack traces, event history, or breadcrumbs.
tools: [list_issue_events, get_event, get_latest_event, list_project_events]
minRole: organizer
mode: inline
---

<events>
- list_issue_events shows all occurrences of a specific issue.
- get_latest_event is the fastest way to see a current stack trace.
- get_event requires both project_slug and event_id.
</events>

<stack_traces>

- Summarize the exception chain: type, value, and top 3-5 relevant frames.
- Skip library/framework frames unless the user asks for the full trace.
- Highlight the application code frame closest to the error.
  </stack_traces>

<breadcrumbs>
- Events include breadcrumbs (console logs, HTTP requests, navigation) leading up to the error.
- Summarize the last 5-10 breadcrumbs for context.
</breadcrumbs>
