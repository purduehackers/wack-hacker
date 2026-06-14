import { z } from "zod";

import { defineTool } from "../_shared/define-tool.ts";
import { linear } from "./client.ts";

export const list_cycles = defineTool({
  name: "list_cycles",
  domain: "linear",
  description:
    "List cycles (sprints) for a team or across the workspace. Returns ID, name, number, start/end dates, and completion stats.",
  access: { risk: "read" },
  input: z.object({
    team_id: z.string().optional().describe("Filter to cycles for this team UUID"),
    first: z.number().max(100).optional(),
  }),
  execute: async ({ team_id, first }) => {
    const cycles = team_id
      ? await (await linear.team(team_id)).cycles({ first: first ?? 25 })
      : await linear.cycles({ first: first ?? 25 });
    return JSON.stringify(
      cycles.nodes.map((c) => ({
        id: c.id,
        number: c.number,
        name: c.name,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        completedAt: c.completedAt,
        progress: c.progress,
      })),
    );
  },
});

export const get_cycle = defineTool({
  name: "get_cycle",
  domain: "linear",
  description: "Get a single cycle's full details by ID.",
  access: { risk: "read" },
  input: z.object({ id: z.string().describe("Cycle UUID") }),
  execute: async ({ id }) => {
    const c = await linear.cycle(id);
    return JSON.stringify({
      id: c.id,
      number: c.number,
      name: c.name,
      description: c.description,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      completedAt: c.completedAt,
      progress: c.progress,
    });
  },
});

export const create_cycle = defineTool({
  name: "create_cycle",
  domain: "linear",
  description:
    "Create a new cycle for a team. Dates are ISO 8601. Name is optional and defaults to a generated name.",
  access: { risk: "write" },
  input: z.object({
    team_id: z.string().describe("Team UUID"),
    name: z.string().optional(),
    description: z.string().optional(),
    starts_at: z.string().describe("ISO 8601 start"),
    ends_at: z.string().describe("ISO 8601 end"),
  }),
  execute: async ({ team_id, starts_at, ends_at, ...rest }) => {
    const payload = await linear.createCycle({
      teamId: team_id,
      startsAt: new Date(starts_at),
      endsAt: new Date(ends_at),
      ...rest,
    });
    const cycle = await payload.cycle;
    if (!cycle) return JSON.stringify({ error: "Failed to create cycle" });
    return JSON.stringify({ id: cycle.id, number: cycle.number, name: cycle.name });
  },
});

export const update_cycle = defineTool({
  name: "update_cycle",
  domain: "linear",
  description: "Update a cycle's name, description, or dates.",
  access: { risk: "write" },
  input: z.object({
    id: z.string().describe("Cycle UUID"),
    name: z.string().optional(),
    description: z.string().optional(),
    starts_at: z.string().optional().describe("ISO 8601 start"),
    ends_at: z.string().optional().describe("ISO 8601 end"),
  }),
  execute: async ({ id, starts_at, ends_at, ...rest }) => {
    const payload = await linear.updateCycle(id, {
      ...rest,
      startsAt: starts_at ? new Date(starts_at) : undefined,
      endsAt: ends_at ? new Date(ends_at) : undefined,
    });
    const cycle = await payload.cycle;
    if (!cycle) return JSON.stringify({ error: "Failed to update cycle" });
    return JSON.stringify({ id: cycle.id, number: cycle.number, name: cycle.name });
  },
});

export const archive_cycle = defineTool({
  name: "archive_cycle",
  domain: "linear",
  description:
    "Archive a cycle. Cycles cannot be hard-deleted in Linear — archiving is the closest equivalent.",
  access: { risk: "destructive" },
  input: z.object({ id: z.string().describe("Cycle UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.archiveCycle(id);
    return JSON.stringify({ success: payload.success });
  },
});
