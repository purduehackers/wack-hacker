---
name: performance
description: Query transaction performance — latency percentiles, throughput, and failure rates.
criteria: Use when the user asks about performance, latency, slow endpoints, throughput, or failure rates.
tools: [list_sentry_transactions, get_sentry_transaction_summary]
minRole: organizer
mode: inline
---

<listing>
- Use `list_sentry_transactions` to see transaction names with aggregate stats (p50, p95, count, failure rate).
- Filter by name substring and sort by p50, p95, count, or failure_rate.
</listing>

<details>
- Use `get_sentry_transaction_summary` for a specific transaction's full latency breakdown (p50/p75/p95/p99), throughput, failure rate, and apdex.
- Specify a time period: 1h, 24h, 7d, 14d, or 30d (default 24h).
</details>
