import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { issueFilter, linear } from "../../client.ts";

export const aggregate_issues = defineTool({
  description:
    "Get aggregated issue counts grouped by status, assignee, label, priority, project, or team. Returns CSV. Use for 'how many issues...', 'break down by...', or distribution questions. Supports optional filters by team, project, assignee, or state.",
  access: { risk: "read" },
  input: z.strictObject({
    groupBy: z.enum(["status", "assignee", "label", "priority", "project", "team"]),
    teamId: z.string().optional(),
    projectId: z.string().optional(),
    assigneeId: z.string().optional(),
    stateId: z.string().optional(),
  }),
  execute: async ({ groupBy, ...filters }) => {
    const page = await linear.issues({ filter: issueFilter(filters), first: 250 });
    const counts = new Map<string, number>();

    for (const item of page.nodes) {
      let bucketList: string[];
      switch (groupBy) {
        case "status":
          bucketList = [(await item.state)?.name ?? "None"];
          break;
        case "assignee":
          bucketList = [(await item.assignee)?.name ?? "Unassigned"];
          break;
        case "priority":
          bucketList = [item.priorityLabel];
          break;
        case "project":
          bucketList = [(await item.project)?.name ?? "None"];
          break;
        case "team":
          bucketList = [(await item.team)?.name ?? "None"];
          break;
        case "label": {
          const labels = await item.labels();
          bucketList = labels.nodes.length > 0 ? labels.nodes.map((l) => l.name) : ["None"];
          break;
        }
      }
      for (const entry of bucketList) counts.set(entry, (counts.get(entry) ?? 0) + 1);
    }

    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k},${v}`);
    return `${groupBy},count\n${rows.join("\n")}`;
  },
});
