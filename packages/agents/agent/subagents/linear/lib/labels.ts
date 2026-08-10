import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { linear } from "./client.ts";
import { hexColor } from "./constants.ts";

/**
 * Value the label projections report for a workspace-wide label, which has no
 * team. Every label in a list keeps the same key set so the model can compare
 * rows, which means "no team" has to serialize as an explicit null rather than
 * a missing key. One named sentinel keeps the rest of this module under the
 * no-null rule.
 */
// oxlint-disable-next-line unicorn/no-null -- serialized label rows keep a stable key set, so an unscoped label is an explicit null
const NO_TEAM = null;

export const list_labels = defineTool({
  description:
    "List issue labels across the Linear workspace. Optionally filter by team. Returns ID, name, color, and team.",
  access: { risk: "read" },
  input: z.strictObject({
    team_id: z.string().optional().describe("Filter to labels for this team UUID"),
    first: z.int().min(1).max(100).optional().describe("Max results"),
  }),
  execute: async ({ team_id, first }) => {
    const labels = team_id
      ? await (await linear.team(team_id)).labels({ first: first ?? 50 })
      : await linear.issueLabels({ first: first ?? 50 });
    const results = await Promise.all(
      labels.nodes.map(async (l) => {
        const team = l.team ? await l.team : undefined;
        return {
          id: l.id,
          name: l.name,
          color: l.color,
          description: l.description,
          team: team ? { id: team.id, name: team.name } : NO_TEAM,
        };
      }),
    );
    return JSON.stringify(results);
  },
});

export const get_label = defineTool({
  description: "Get details for a single label by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: z.string().describe("Label UUID") }),
  execute: async ({ id }) => {
    const l = await linear.issueLabel(id);
    const team = l.team ? await l.team : undefined;
    return JSON.stringify({
      id: l.id,
      name: l.name,
      color: l.color,
      description: l.description,
      team: team ? { id: team.id, name: team.name } : NO_TEAM,
    });
  },
});

export const create_label = defineTool({
  description:
    "Create a new issue label. Scope to a team by passing team_id, otherwise creates a workspace-wide label.",
  access: { risk: "write" },
  input: z.strictObject({
    name: z.string().describe("Label name"),
    color: hexColor.exactOptional().describe("Hex color with leading # (e.g. '#FF0000')"),
    description: z.string().exactOptional(),
    team_id: z.string().exactOptional().describe("Team UUID to scope the label to"),
  }),
  execute: async ({ team_id, ...rest }) => {
    const payload = await linear.createIssueLabel({
      ...rest,
      ...(team_id === undefined ? {} : { teamId: team_id }),
    });
    const label = await payload.issueLabel;
    if (!label) return JSON.stringify({ error: "Failed to create label" });
    return JSON.stringify({ id: label.id, name: label.name, color: label.color });
  },
});

export const update_label = defineTool({
  description: "Update a label's name, color, or description.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string().describe("Label UUID"),
    name: z.string().exactOptional(),
    color: hexColor.exactOptional().describe("Hex color with leading #"),
    description: z.string().exactOptional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateIssueLabel(id, input);
    const label = await payload.issueLabel;
    if (!label) return JSON.stringify({ error: "Failed to update label" });
    return JSON.stringify({ id: label.id, name: label.name, color: label.color });
  },
});

export const delete_label = defineTool({
  description:
    "Delete a label. This removes it from all issues. Irreversible — always confirm with the user.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: z.string().describe("Label UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.deleteIssueLabel(id);
    return JSON.stringify({ success: payload.success });
  },
});
