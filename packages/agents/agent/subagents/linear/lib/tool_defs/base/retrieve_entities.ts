import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const retrieve_entities = defineTool({
  description:
    "Fetch full details for one or more entities by ID, identifier (e.g. TEAM-123), or URL. Returns all fields including description, state, assignee, labels, relations, and URLs. Use this to get the full picture of an entity before acting on it.",
  access: { risk: "read" },
  input: z.strictObject({
    entities: z
      .array(
        z.strictObject({
          type: z.enum(["Issue", "Project", "Document", "User", "Team", "Initiative"]),
          id: z.string(),
        }),
      )
      .min(1)
      .max(10),
  }),
  execute: async ({ entities }) => {
    const results = await Promise.all(
      entities.map(async ({ type, id }) => {
        switch (type) {
          case "Issue": {
            const i = await linear.issue(id);
            const [state, assignee, team, project, labels] = await Promise.all([
              i.state,
              i.assignee,
              i.team,
              i.project,
              i.labels(),
            ]);
            return {
              id: i.id,
              identifier: i.identifier,
              title: i.title,
              description: i.description,
              priority: i.priority,
              dueDate: i.dueDate,
              url: i.url,
              state: state?.name,
              assignee: assignee?.name,
              team: team?.name,
              project: project?.name,
              labels: labels.nodes.map((l) => l.name),
            };
          }
          case "Project": {
            const p = await linear.project(id);
            const [lead, teams, milestones] = await Promise.all([
              p.lead,
              p.teams(),
              p.projectMilestones(),
            ]);
            return {
              id: p.id,
              name: p.name,
              description: p.description,
              state: p.state,
              url: p.url,
              lead: lead?.name,
              teams: teams.nodes.map((t) => t.name),
              milestones: milestones.nodes.map((m) => ({
                id: m.id,
                name: m.name,
                targetDate: m.targetDate,
              })),
            };
          }
          case "Document": {
            const d = await linear.document(id);
            return { id: d.id, title: d.title, content: d.content?.slice(0, 2000), url: d.url };
          }
          case "User": {
            const u = await linear.user(id);
            return { id: u.id, name: u.name, email: u.email, displayName: u.displayName };
          }
          case "Team": {
            const t = await linear.team(id);
            return { id: t.id, name: t.name, key: t.key, description: t.description };
          }
          case "Initiative": {
            const i = await linear.initiative(id);
            const owner = await i.owner;
            return {
              id: i.id,
              name: i.name,
              description: i.description,
              status: i.status,
              targetDate: i.targetDate,
              url: i.url,
              owner: owner?.name,
            };
          }
        }
      }),
    );
    return JSON.stringify(results);
  },
});
