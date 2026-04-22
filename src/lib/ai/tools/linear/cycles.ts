import { tool } from "ai";
import { z } from "zod";

import { linear } from "./client.ts";

export const list_cycles = tool({
  description:
    "List cycles (sprints) for a team or across the workspace. Returns ID, name, number, start/end dates, and completion stats.",
  inputSchema: z.object({
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

export const get_cycle = tool({
  description: "Get a single cycle's full details by ID.",
  inputSchema: z.object({ id: z.string().describe("Cycle UUID") }),
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

export const create_cycle = tool({
  description:
    "Create a new cycle for a team. Dates are ISO 8601. Name is optional and defaults to a generated name.",
  inputSchema: z.object({
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

export const update_cycle = tool({
  description: "Update a cycle's name, description, or dates.",
  inputSchema: z.object({
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

// destructive
export const archive_cycle = tool({
  description:
    "Archive a cycle. Cycles cannot be hard-deleted in Linear — archiving is the closest equivalent.",
  inputSchema: z.object({ id: z.string().describe("Cycle UUID") }),
  execute: async ({ id }) => {
    const payload = await linear.archiveCycle(id);
    return JSON.stringify({ success: payload.success });
  },
});
