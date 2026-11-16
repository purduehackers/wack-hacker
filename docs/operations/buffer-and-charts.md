# Buffer and charts

The `buffer` subagent exposes every operation in the reviewed public Buffer schema: 24 queries and 25 mutations. Its 50th tool, `metric_snapshots`, reads Wack Hacker's optional observation history. General charting lives in the root `render_chart` tool, so it also works with attendance, finance, GitHub and supplied tables.

The implementation uses the existing domain policy and catalog. Reads and ordinary writes require organizer access; deletions require admin access and the existing destructive confirmation flow. Both discovery and execution check authorization. Calls use the fixed Buffer endpoint and cannot introduce another GraphQL root through a response selection. Native HTTP access is not exposed to the model.

## Configuration and rollout

Configure these on the agent deployment, and in the ignored `packages/agents/.env.local` for local use:

| Variable                           | Purpose                                                             |
| ---------------------------------- | ------------------------------------------------------------------- |
| `BUFFER_API_KEY`                   | Personal Buffer API key                                             |
| `BUFFER_ORGANIZATION_IDS`          | Comma-separated permitted organization IDs                          |
| `ARTIFACT_READ_WRITE_TOKEN`        | Private Vercel Blob store                                           |
| `ARTIFACT_PUBLIC_READ_WRITE_TOKEN` | Separate public Vercel Blob media store                             |
| `CHART_ATTACHMENTS_ENABLED`        | Defaults to false; enable after the compatible bot and agent deploy |
| `BUFFER_SNAPSHOTS_ENABLED`         | Defaults to false; enables optional daily observation collection    |

The key's **entire account membership** must fit the configured organization list. Every call checks account membership before executing, including operations accepting only a resource ID. This deliberately fails closed if the account later gains access to an unconfigured organization. It avoids relying on guessed ownership lookups for resources with no individual read operation. The extra membership read also consumes quota.

The bot needs no Blob credential. It downloads artifacts from the agent's authenticated `/discord/artifact` route using its existing ingress credential. The route binds a file to the persisted delivery target, requester, channel and dispatch. Merely knowing an artifact ID grants no access.

November 15 setup:

- Vercel project: `purdue-hackers/wack-hacker-v2` (`prj_SSfMKHoa7ckejrFn3UfbMwbkpqWN`).
- Buffer organization: Afterhours (`6afa376787a507c746de87e9`), with connected Instagram, LinkedIn and X channels for Purdue Hackers.
- Private store: `wack-hacker-artifacts` (`store_tgAtIpyBQpfSAZhA`).
- Public store: `wack-hacker-public-media` (`store_eR9MeOHInyw8AUhq`).
- Both stores are connected to development, preview and production. Buffer secrets and organization configuration are staged in Vercel.
- Migration `0001_superb_mister_fear.sql` is applied to the project's existing Turso database. It adds three tables and an index; it changes no existing table.
- Chart delivery and daily snapshots remain disabled in deployed configuration.

Buffer uses the shared native Redis client through `REDIS_URL`, including its cross-instance request lock and quota windows. The bot and agent use the same connection. A live read through this client verified all three connected channels.

Release sequence:

1. Run the checks below and build the bot image using the existing release workflow. Keep `CHART_ATTACHMENTS_ENABLED=false`.
2. Deploy compatible bot and agent versions, including the shared wire schema and the native Linux resvg dependency. Vercel must build on its target platform; do not upload a Mac-built native binary.
3. Verify bot health and one ordinary Eve conversation. Enable chart delivery and redeploy the agent.
4. Request a chart in `p-wack-hacker`, then verify its PNG/SVG/CSV and a renderer restart. Enable snapshots separately only if observation history is wanted.

## Using Buffer

All generated tools take `arguments` matching the upstream GraphQL arguments, an optional `selection`, `maxPages` from 1 to 10, and `exportDataset`. Inputs preserve omission versus explicit `null`. Responses retain GraphQL errors, typed mutation failures, partial-success data, pagination completeness and rate-limit information. Useful identity/error fields are always included with a custom selection.

Example input for `posts`:

```json
{
  "arguments": {
    "input": { "organizationId": "6afa376787a507c746de87e9", "filter": { "status": ["sent"] } },
    "first": 100
  },
  "selection": "edges { node { id channelId channelService dueAt metricsUpdatedAt metrics { type unit value } } }",
  "maxPages": 10,
  "exportDataset": true
}
```

The response includes a dataset ID for `render_chart`; use `rowsPath: "pages.*.data.edges.*.node"`. Incomplete or failed datasets cannot be charted as complete. Continue pagination or deliberately supply and label a partial table.

Mutations record their intent in Turso before contacting Buffer. An identical replay returns the saved result. A crash or lost response leaves an uncertain record and never silently repeats the mutation. Re-fetch the affected resource before deciding on another action. This is local replay protection, not a claim of provider-side idempotency. Test fixtures cover uncertain writes; live social publication was not used for testing.

Quota handling serializes requests across instances, records exhausted rate-limit windows, and bounds pagination, bodies and timeouts. An upstream preview/experimental feature can still be unavailable for this account. API acceptance, scheduled publication and successful network delivery remain different outcomes.

## Charts and files

Supported plots are line, grouped bar, stacked bar, area, scatter, histogram, heatmap and donut, in light or dark PH themes. ECharts renders SVG and resvg creates PNG with bundled Inter fonts. The model supplies a strict data/specification object, never executable chart code or remote graphic URLs.

```json
{
  "rows": [
    { "week": "Nov 6", "attendance": 82 },
    { "week": "Nov 13", "attendance": 94 }
  ],
  "spec": {
    "type": "bar",
    "title": "Hack Night attendance",
    "x": "week",
    "y": "attendance",
    "unit": "count",
    "source": "Illustrative supplied table",
    "alt": "Example attendance increases from 82 to 94."
  }
}
```

Use `series` for grouped bars or multiple lines. Use `aggregate` and `timeBucket` for explicit sum, mean or count operations and local day/week/month grouping. Missing values stay unknown; duplicate categories require an explicit aggregation and percentages cannot be summed. Charts are bounded to 5000 source rows, 1000 plotted points, 12 series and 1800×1200 pixels. The specification preserves source, period, freshness and timezone. CSV exports neutralize spreadsheet formulas.

Each successful call creates a saved `chartId` plus PNG, SVG and CSV files. A revision supplies `previousChartId` and a replacement `spec`, reusing the saved rows. Files become visible together only after all exports succeed. Reply budgets are 10 attachments, 8 MB per file and 24 MB total. Alt text is sent as Discord attachment descriptions.

Artifacts are private and scoped to the same requester and channel. Unretained files expire after 30 days, beyond render recovery retention; the daily cleanup removes expired bodies and metadata. `retained: true` pins a report. Public media stays pinned indefinitely, so a queued social post never loses its source file because of automatic cleanup.

When the user requests public sharing, `publish_artifact` copies a selected artifact to the public store and returns a stable URL for Buffer. It also accepts a Discord attachment URL for PNG, JPEG, WebP, GIF, MP4, MOV or PDF, up to 8 MB. It validates the Discord CDN host and path, blocks redirects and bounds download size. Larger media can be supplied directly to Buffer using an existing stable public URL. This operation makes the selected file public; creating a chart by itself does not.

## Metric interpretation and history

Buffer metrics are cumulative observations, generally updated daily. Post publication dates define cohorts; they do not tell you when engagement happened. The public API has no total account follower-history query. Post-attributed follows cannot substitute for total follower growth. Absent metrics stay absent; Buffer also documents provider defaults of zero for some unavailable network measurements.

The optional collector runs at 09:00 UTC daily and stores up to 2000 sent posts per organization with collection status, post/channel IDs and source metric timestamps. Capped collections are marked partial. History starts when enabled and is not backfilled. The `metric_snapshots` tool can export an authorized dataset with `rowsPath: "snapshots.*.posts.*"`. Compare consistent cohorts between observations.

## Contract maintenance and validation

The reviewed SDL, generated input schemas and 49-operation manifest live under `agent/subagents/buffer/lib/`. `bun run buffer:schema` verifies tool policies, every root operation and all generated input fields. `bun run buffer:schema --refresh` uses live introspection, reports breaking/dangerous changes, and regenerates the snapshot, inputs and manifest. Review the diff and add wrappers for new operations; the coverage check fails until they are represented. Run formatting and `bun run readmes` afterward.

Required checks: `bun run lint`, `bunx oxfmt --check .`, `bun test ./packages`, and the agent's `check:capabilities`, `check:serialization`, `buffer:schema`, and `build` scripts. Do not suppress lint rules to make these pass.

Verified during implementation:

- All 49 default GraphQL documents validate; all input fields match generated schemas and role policies.
- Live read-only account/channel/post access: 3 channels, 62 sent posts, including 33 in 2026. Those are available API records, not an assertion of complete lifetime social history.
- All eight chart types, both themes, missing data and local week boundaries render under Bun. The real-data sample also rendered on Linux x64 with Bun 1.3.14 and native resvg; the final Eve production build passed locally.
- Private Blob upload/download, Turso metadata, three-file delivery and cross-requester denial passed.
- [Live sample in p-wack-hacker](https://discord.com/channels/772576325897945119/1463772489380401310/1571721334583468115): the actual bot attachment code uploaded the files. A subsequent text edit preserved them. A fresh process recovered the same Discord attachment IDs without another download or upload.
- Full repository lint/formatting, 57 standard tests, the schema/capability/serialization checks, the production build and clean-database migration checks passed. Four native Redis compatibility tests also passed against the configured server.
- Mutation failure/replay tests are simulated; no live Buffer writes were performed.

Run the full checks from a clean checkout of this branch. The historical live Discord sample verifies the attachment path; after deployment, also request a chart through the complete Eve conversation flow.
