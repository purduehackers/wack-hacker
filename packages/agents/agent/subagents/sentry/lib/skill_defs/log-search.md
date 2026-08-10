---
description: Search structured logs and inspect log volume over time.
---

## When to use

Use when the user asks about application logs, log search, log levels, or log spikes/volume over time.

## Relevant tools

`search_logs`, `get_log_stats`

## Instructions

<search>
- search_logs queries structured log entries across a project's `logs` dataset.
- Filter with `query` using Sentry search syntax — e.g. `level:error`, `message:*timeout*`, or tag filters.
- `stat_period` bounds the window (`1h`, `24h`, `7d`; default `24h`); `sort` defaults to `-timestamp`.
- `fields` picks the columns returned (default: message, severity_text, timestamp, trace_id).
</search>

<stats>
- get_log_stats returns log volume as a time series — use it to spot spikes before drilling in with search_logs.
- `y_axis` defaults to `count()`; narrow with `query`, bound with `stat_period`.
</stats>
