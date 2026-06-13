import { z } from "zod";

import { defineTool } from "../_shared/define-tool.ts";
import { linear } from "./client.ts";

export const list_labels = defineTool({
  name: "list_labels",
  domain: "linear",
  description:
    "List issue labels across the Linear workspace. Optionally filter by team. Returns ID, name, color, and team.",
  access: { risk: "read" },
  input: z.object({
    team_id: z.string().optional().describe("Filter to labels for this team UUID"),
    first: z.number().max(100).optional().describe("Max results"),
  }),
  execute: async ({ team_id, first }) => {
    const labels = team_id
      ? await (await linear.team(team_id)).labels({ first: first ?? 50 })
      : await linear.issueLabels({ first: first ?? 50 });
    const results = await Promise.all(
      labels.nodes.map(async (l) => {
        const team = l.team ? await l.team : null;
        return {
          id: l.id,
          name: l.name,
          color: l.color,
          description: l.description,
          team: team ? { id: team.id, name: team.name } : null,
        };
      }),
    );
    return JSON.stringify(results);
  },
});

export const get_label = defineTool({
  name: "get_label",
  domain: "linear",
  description: "Get details for a single label by ID.",
  access: { risk: "read" },
  input: z.object({ id: z.string().describe("Label UUID") }),
  execute: async ({ id }) => {
    const l = await linear.issueLabel(id);
    const team = l.team ? await l.team : null;
    return JSON.stringify({
      id: l.id,
      name: l.name,
      color: l.color,
      description: l.description,
      team: team ? { id: team.id, name: team.name } : null,
    });
  },
});

export const create_label = defineTool({
  name: "create_label",
  domain: "linear",
  description:
    "Create a new issue label. Scope to a team by passing team_id, otherwise creates a workspace-wide label.",
  access: { risk: "write" },
  input: z.object({
    name: z.string().describe("Label name"),
    color: z.string().optional().describe("Hex color with leading # (e.g. '#FF0000')"),
    description: z.string().optional(),
    team_id: z.string().optional().describe("Team UUID to scope the label to"),
  }),
  execute: async ({ name, color, description, team_id }) => {
    const payload = await linear.createIssueLabel({
      name,
      color,
      description,
      teamId: team_id,
    });
    const label = await payload.issueLabel;
    if (!label) return JSON.stringify({ error: "Failed to create label" });
    return JSON.stringify({ id: label.id, name: label.name, color: label.color });
  },
});

export const update_label = defineTool({
  name: "update_label",
  domain: "linear",
  description: "Update a label's name, color, or description.",
  access: { risk: "write" },
  input: z.object({
    id: z.string().describe("Label UUID"),
    name: z.string().optional(),
    color: z.string().optional().describe("Hex color with leading #"),
    description: z.string().optional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateIssueLabel(id, input);
    const label = await payload.issueLabel;
    if (!label) return JSON.stringify({ error: "Failed to update label" });
    return JSON.stringify({ id: label.id, name: label.name, color: label.color });
  },
});

export const delete_label = defineTool({
  name: "delete_label",
  domain: "linear",
  description:
    "Delete a label. This removes it from all issues. Irreversible — always confirm with the user.",
  access: { risk: "destructive" },
  input: z.object({ id: z.string().describe("Label UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.deleteIssueLabel(id);
    return JSON.stringify({ success: payload.success });
  },
});
