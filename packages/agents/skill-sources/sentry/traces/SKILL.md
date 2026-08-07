---
name: traces
description: View distributed traces — full request waterfalls across services.
criteria: Use when the user asks about traces, distributed tracing, request waterfalls, or wants to follow a request across services.
tools: [get_trace, list_traces]
minRole: organizer
mode: inline
---

<traces>
- get_trace returns the full trace waterfall for a specific trace ID.
- Includes all transactions, spans, errors, and performance issues.
- Trace IDs are 32-character hex strings.
</traces>

<searching>
- list_traces searches for traces via the Discover API.
- Filter by transaction name, duration, or other event fields.
- Results include trace ID, transaction name, and timestamps.
</searching>
