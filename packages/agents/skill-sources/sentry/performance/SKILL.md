---
name: performance
description: Query transaction performance, latency, throughput, and span data.
criteria: Use when the user asks about slow endpoints, latency, throughput, p95/p99, or transaction performance.
tools: [list_transactions, get_transaction_summary, list_spans]
minRole: organizer
mode: inline
---

<transactions>
- list_transactions uses the Discover API to query transaction events.
- Common fields: transaction, count(), p50(), p75(), p95(), p99(), avg().
- Filter by project, date range, and transaction name.
</transactions>

<stats>
- get_transaction_summary returns time-series performance data for a specific transaction.
- Useful for spotting regressions or trends.
</stats>

<spans>
- list_spans queries span-level data for deeper performance analysis.
- Use to find slow database queries, HTTP calls, or specific operations within a transaction.
</spans>
