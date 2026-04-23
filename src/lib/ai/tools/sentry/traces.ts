import { tool } from "ai";
import { z } from "zod";

import { perPageField } from "../_shared/constants.ts";
import { sentryGet, sentryOrg } from "./client.ts";

/** Get a full distributed trace by trace ID. */
export const get_trace = tool({
  description:
    "Get a full distributed trace by trace ID. Returns the complete trace waterfall with all transactions, spans, errors, and performance issues.",
  inputSchema: z.object({
    trace_id: z.string().describe("Trace ID (32-character hex string)"),
    project_slug: z.string().optional().describe("Project slug to scope the trace lookup"),
  }),
  execute: async ({ trace_id, project_slug }) => {
    const data = await sentryGet(
      `/organizations/${sentryOrg()}/events-trace/${trace_id}/`,
      project_slug ? { project: project_slug } : undefined,
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
    per_page: perPageField,
    stat_period: z
      .string()
      .optional()
      .describe("Time range (e.g. '24h', '7d'). Defaults to '24h'."),
  }),
  execute: async ({ project_slug, query, sort, per_page, stat_period }) => {
    const fields = ["trace", "transaction", "count()", "min(timestamp)", "max(timestamp)"];
    const data = await sentryGet(`/organizations/${sentryOrg()}/events/`, {
      dataset: "discover",
      project: project_slug,
      statsPeriod: stat_period ?? "24h",
      field: fields,
      query: query ? `event.type:transaction ${query}` : "event.type:transaction",
      sort,
      per_page,
    });
    return JSON.stringify(data);
  },
});
