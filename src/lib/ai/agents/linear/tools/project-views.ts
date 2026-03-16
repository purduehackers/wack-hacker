import { tool } from "ai";
import { z } from "zod";

import { linear } from "../client";

export const query_project_view = tool({
  description:
    "List projects with lead/status/URL, or get a total count. Use list mode for 'which projects are...' and count mode for 'how many projects...'.",
  inputSchema: z.object({
    mode: z.enum(["list", "count"]).default("list"),
    first: z.number().optional().default(25).describe("Max 50, list mode only"),
  }),
  execute: async ({ mode, first }) => {
    const projects = await linear.projects({ first: Math.min(first, 50) });
    if (mode === "count") return JSON.stringify({ count: projects.nodes.length });
    const results = await Promise.all(
      projects.nodes.map(async (p) => {
        const lead = await p.lead;
        return { id: p.id, name: p.name, state: p.state, url: p.url, lead: lead?.name };
      }),
    );
    return JSON.stringify(results);
  },
});
