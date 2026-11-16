---
description: Buffer post metrics, channel comparisons, chart datasets, and optional observed history.
---

Use the typed metrics operations. Their arguments match Buffer's public GraphQL schema. All reads and ordinary writes require organizer access; deletions require admin access. Preview and experimental features may be unavailable for the current account.

Use selection to include extra response fields. Keep maxPages bounded and inspect complete/pageInfo before claiming a full result. Mutations return success or typed errors; HTTP acceptance does not mean publication. Never repeat an uncertain mutation without checking affected resources. Use exportDataset when the root agent needs data for a chart.

Only perform writes requested by the user. Check allowedActions and channel capabilities. Preserve upstream omitted-versus-null semantics and never substitute an unsupported operation with a different write.

Prefer `aggregated_post_metrics` for totals. Its date window is limited to 365 days; use per-channel queries to preserve network-specific metrics that mixed-channel aggregates omit. For per-post charts, use `posts` with `selection: "edges { node { id channelId channelService dueAt metricsUpdatedAt metrics { type unit value } } }"`, bounded `maxPages`, and `exportDataset: true`. Return the dataset ID in artifacts and tell the root to use `rowsPath: "pages.*.data.edges.*.node"`. `render_chart` can read a metric by name, e.g. `y: "metrics.reactions"`.

The default posts selection includes identity and dates, but request `metrics` explicitly. Metrics are cumulative current values and usually update daily. Preserve `metricsUpdatedAt`; an absent metric is not zero. Buffer documents that some reported numeric zeros can themselves be defaults when a network did not supply a measurement. Do not overstate precision. Percentage metrics cannot be summed. A chart grouped by `dueAt` shows publication cohorts, not engagement received during those periods. The API has no total follower-history endpoint.

`metric_snapshots` reads the optional Wack Hacker daily collector. It starts only after `BUFFER_SNAPSHOTS_ENABLED` is enabled by an operator. It cannot backfill historical observations. It records at most 2000 sent posts per organization per day and marks capped or failed collections. Use `rowsPath: "snapshots.*.posts.*"` with an exported snapshot dataset. Compare the same posts and metric types between observations; missing posts or reset counters are not negative engagement. Narrow the time range when `complete` is false.
