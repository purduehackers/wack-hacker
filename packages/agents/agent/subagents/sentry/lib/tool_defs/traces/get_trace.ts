import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryGet, sentryOrg } from "../../client.ts";

export const get_trace = defineTool({
  description:
    "Get a full distributed trace by trace ID. Returns the complete trace waterfall with all transactions, spans, errors, and performance issues.",
  access: { risk: "read" },
  input: z.strictObject({
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
