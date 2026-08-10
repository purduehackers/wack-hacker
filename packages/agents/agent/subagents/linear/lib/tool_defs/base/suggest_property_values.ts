import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const suggest_property_values = defineTool({
  description:
    "Resolve human-readable names to Linear UUIDs for entity fields. MUST be called before create/update to get valid IDs for assignee, team, status, project, cycle, labels, or milestone. Use field 'Issue.assigneeId' with a name query to find a user's ID.",
  access: { risk: "read" },
  input: z.strictObject({
    field: z.enum([
      "Issue.assigneeId",
      "Issue.stateId",
      "Issue.labelIds",
      "Issue.teamId",
      "Issue.projectId",
      "Issue.cycleId",
      "Issue.projectMilestoneId",
    ]),
    query: z.string().optional().describe("Filter by name"),
    scope: z
      .strictObject({
        type: z.enum(["Team", "Project"]),
        id: z.string(),
      })
      .optional()
      .describe("Required for stateId (Team), cycleId (Team), projectMilestoneId (Project)"),
  }),
  execute: async ({ field, query, scope }) => {
    const q = query?.toLowerCase();
    const scopeId = scope?.id;

    switch (field) {
      case "Issue.assigneeId": {
        const r = await linear.users();
        const items = q ? r.nodes.filter((u) => u.name.toLowerCase().includes(q)) : r.nodes;
        return JSON.stringify(items.map((u) => ({ id: u.id, name: u.name })));
      }
      case "Issue.stateId": {
        if (!scopeId) return "Team scope required for status lookup";
        const r = await linear.workflowStates({ filter: { team: { id: { eq: scopeId } } } });
        return JSON.stringify(r.nodes.map((s) => ({ id: s.id, name: s.name, type: s.type })));
      }
      case "Issue.labelIds": {
        const r = await linear.issueLabels();
        const items = q ? r.nodes.filter((l) => l.name.toLowerCase().includes(q)) : r.nodes;
        return JSON.stringify(items.map((l) => ({ id: l.id, name: l.name })));
      }
      case "Issue.teamId": {
        const r = await linear.teams();
        return JSON.stringify(r.nodes.map((t) => ({ id: t.id, name: t.name, key: t.key })));
      }
      case "Issue.projectId": {
        const r = await linear.projects();
        return JSON.stringify(r.nodes.map((p) => ({ id: p.id, name: p.name })));
      }
      case "Issue.cycleId": {
        if (!scopeId) return "Team scope required for cycle lookup";
        const r = await linear.cycles({ filter: { team: { id: { eq: scopeId } } } });
        return JSON.stringify(r.nodes.map((c) => ({ id: c.id, name: c.name, number: c.number })));
      }
      case "Issue.projectMilestoneId": {
        if (!scopeId) return "Project scope required for milestone lookup";
        const project = await linear.project(scopeId);
        const r = await project.projectMilestones();
        return JSON.stringify(
          r.nodes.map((m) => ({ id: m.id, name: m.name, targetDate: m.targetDate })),
        );
      }
    }
  },
});
