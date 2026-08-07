---
name: metrics
description: Query custom metrics — counters, distributions, gauges, and sets.
criteria: Use when the user asks about custom metrics, counters, distributions, gauges, or application-level numeric data.
tools: [list_metrics, query_metrics, list_metric_tags, get_metric_tag_values]
minRole: organizer
mode: inline
---

<metrics>
- list_metrics shows all available custom metrics and their types.
- Metrics use MRI (Metric Resource Identifier) format: `{type}:custom/{name}@{unit}`.
- Types: c (counter), d (distribution), g (gauge), s (set).
- Example MRI: `c:custom/page_views@none`, `d:custom/response_time@millisecond`.
</metrics>

<querying>
- query_metrics returns time-series data for a specific metric.
- Aggregation ops: sum, count, avg, min, max, p50, p75, p90, p95, p99.
- Use group_by to break down by tag (e.g. environment, endpoint).
- Use query to filter by tag values (e.g. 'environment:production').
</querying>

<tags>
- list_metric_tags shows available tag keys for filtering/grouping.
- get_metric_tag_values shows values for a specific tag.
</tags>
