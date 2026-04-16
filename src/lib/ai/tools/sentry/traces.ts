import { tool } from "ai";
import { z } from "zod";

import { sentryGet, sentryOrg } from "./client.ts";

interface TraceEvent {
  event_id: string;
  span_id: string;
  transaction: string;
  "transaction.duration": number;
  "transaction.op": string;
  project_slug: string;
  timestamp: string;
  children: TraceEvent[];
  errors: unknown[];
  performance_issues: unknown[];
}

/** Get a full distributed trace by trace ID. */
export const get_trace = tool({
  description:
    "Get a full distributed trace by trace ID. Returns the complete trace waterfall with all transactions, spans, errors, and performance issues.",
  inputSchema: z.object({
    trace_id: z.string().describe("Trace ID (32-character hex string)"),
    project_slug: z.string().optional().describe("Project slug to scope the trace lookup"),
  }),
  execute: async ({ trace_id, project_slug }) => {
    const params = new URLSearchParams();
    if (project_slug) params.set("project", project_slug);
    const data = await sentryGet<TraceEvent[]>(
      `/organizations/${sentryOrg()}/events-trace/${trace_id}/?${params}`,
    );
    return JSON.stringify(data);
  },
});

/** List traces matching a query. */
export const list_traces = tool({
  description:
    "Search for traces in the organization. Returns trace IDs with summary info like duration, span count, and root transaction.",
  inputSchema: z.object({
    project_slug: z.string().describe("Project slug"),
    query: z.string().optional().describe("Filter query (e.g. 'transaction:GET /api/users')"),
    sort: z.string().optional().describe("Sort field (e.g. '-timestamp', '-duration')"),
    per_page: z.number().max(100).optional(),
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, query, sort, per_page, stat_period }) => {
    const params = new URLSearchParams();
    params.set("dataset", "discover");
    params.set("project", project_slug);
    params.set("statsPeriod", stat_period ?? "24h");
    params.append("field", "trace");
    params.append("field", "transaction");
    params.append("field", "count()");
    params.append("field", "min(timestamp)");
    params.append("field", "max(timestamp)");
    if (query) params.set("query", `event.type:transaction ${query}`);
    else params.set("query", "event.type:transaction");
    if (sort) params.set("sort", sort);
    if (per_page) params.set("per_page", String(per_page));
    const data = await sentryGet(`/organizations/${sentryOrg()}/events/?${params}`);
    return JSON.stringify(data);
  },
});
