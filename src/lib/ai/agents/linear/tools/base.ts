import { tool } from "ai";
import { z } from "zod";

import { linear, issueFilter } from "../client";

const json = JSON.stringify;

export const search_entities = tool({
  description:
    "Search Linear entities by keyword. Use for finding issues, projects, documents, initiatives, users, teams, customers, or labels. Returns IDs, names/identifiers, and URLs. Use entityType 'User' to resolve a person's name to their Linear user ID.",
  inputSchema: z.object({
    query: z.string(),
    entityType: z.enum([
      "Issue",
      "Project",
      "Document",
      "Initiative",
      "User",
      "Team",
      "Customer",
      "IssueLabel",
    ]),
  }),
  execute: async ({ query, entityType }) => {
    const q = query.toLowerCase();
    switch (entityType) {
      case "Issue": {
        const r = await linear.searchIssues(query);
        return json(
          r.nodes.map((i) => ({ id: i.id, identifier: i.identifier, title: i.title, url: i.url })),
        );
      }
      case "Project": {
        const r = await linear.searchProjects(query);
        return json(r.nodes.map((p) => ({ id: p.id, name: p.name, url: p.url })));
      }
      case "Document": {
        const r = await linear.searchDocuments(query);
        return json(r.nodes.map((d) => ({ id: d.id, title: d.title, url: d.url })));
      }
      case "Initiative": {
        const r = await linear.initiatives();
        return json(
          r.nodes
            .filter(
              (i) => i.name.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q),
            )
            .map((i) => ({ id: i.id, name: i.name, status: i.status, url: i.url })),
        );
      }
      case "User": {
        const r = await linear.users();
        return json(
          r.nodes
            .filter((u) => u.name.toLowerCase().includes(q))
            .map((u) => ({ id: u.id, name: u.name, email: u.email })),
        );
      }
      case "Team": {
        const r = await linear.teams();
        return json(
          r.nodes
            .filter((t) => t.name.toLowerCase().includes(q) || t.key.toLowerCase().includes(q))
            .map((t) => ({ id: t.id, name: t.name, key: t.key })),
        );
      }
      case "Customer": {
        const r = await linear.customers();
        return json(
          r.nodes
            .filter((c) => c.name.toLowerCase().includes(q))
            .map((c) => ({ id: c.id, name: c.name })),
        );
      }
      case "IssueLabel": {
        const r = await linear.issueLabels();
        return json(
          r.nodes
            .filter((l) => l.name.toLowerCase().includes(q))
            .map((l) => ({ id: l.id, name: l.name })),
        );
      }
    }
  },
});

export const retrieve_entities = tool({
  description:
    "Fetch full details for one or more entities by ID, identifier (e.g. TEAM-123), or URL. Returns all fields including description, state, assignee, labels, relations, and URLs. Use this to get the full picture of an entity before acting on it.",
  inputSchema: z.object({
    entities: z
      .array(
        z.object({
          type: z.enum(["Issue", "Project", "Document", "User", "Team", "Initiative"]),
          id: z.string(),
        }),
      )
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
    return json(results);
  },
});

export const suggest_property_values = tool({
  description:
    "Resolve human-readable names to Linear UUIDs for entity fields. MUST be called before create/update to get valid IDs for assignee, team, status, project, cycle, labels, or milestone. Use field 'Issue.assigneeId' with a name query to find a user's ID.",
  inputSchema: z.object({
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
      .object({
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
        return json(items.map((u) => ({ id: u.id, name: u.name })));
      }
      case "Issue.stateId": {
        if (!scopeId) return "Team scope required for status lookup";
        const r = await linear.workflowStates({ filter: { team: { id: { eq: scopeId } } } });
        return json(r.nodes.map((s) => ({ id: s.id, name: s.name, type: s.type })));
      }
      case "Issue.labelIds": {
        const r = await linear.issueLabels();
        const items = q ? r.nodes.filter((l) => l.name.toLowerCase().includes(q)) : r.nodes;
        return json(items.map((l) => ({ id: l.id, name: l.name })));
      }
      case "Issue.teamId": {
        const r = await linear.teams();
        return json(r.nodes.map((t) => ({ id: t.id, name: t.name, key: t.key })));
      }
      case "Issue.projectId": {
        const r = await linear.projects();
        return json(r.nodes.map((p) => ({ id: p.id, name: p.name })));
      }
      case "Issue.cycleId": {
        if (!scopeId) return "Team scope required for cycle lookup";
        const r = await linear.cycles({ filter: { team: { id: { eq: scopeId } } } });
        return json(r.nodes.map((c) => ({ id: c.id, name: c.name, number: c.number })));
      }
      case "Issue.projectMilestoneId": {
        if (!scopeId) return "Project scope required for milestone lookup";
        const project = await linear.project(scopeId);
        const r = await project.projectMilestones();
        return json(r.nodes.map((m) => ({ id: m.id, name: m.name, targetDate: m.targetDate })));
      }
    }
  },
});

export const aggregate_issues = tool({
  description:
    "Get aggregated issue counts grouped by status, assignee, label, priority, project, or team. Returns CSV. Use for 'how many issues...', 'break down by...', or distribution questions. Supports optional filters by team, project, assignee, or state.",
  inputSchema: z.object({
    groupBy: z.enum(["status", "assignee", "label", "priority", "project", "team"]),
    teamId: z.string().optional(),
    projectId: z.string().optional(),
    assigneeId: z.string().optional(),
    stateId: z.string().optional(),
  }),
  execute: async ({ groupBy, ...filters }) => {
    const issues = await linear.issues({ filter: issueFilter(filters), first: 250 });
    const counts = new Map<string, number>();

    for (const issue of issues.nodes) {
      let keys: string[];
      switch (groupBy) {
        case "status":
          keys = [(await issue.state)?.name ?? "None"];
          break;
        case "assignee":
          keys = [(await issue.assignee)?.name ?? "Unassigned"];
          break;
        case "priority":
          keys = [issue.priorityLabel];
          break;
        case "project":
          keys = [(await issue.project)?.name ?? "None"];
          break;
        case "team":
          keys = [(await issue.team)?.name ?? "None"];
          break;
        case "label": {
          const labels = await issue.labels();
          keys = labels.nodes.length > 0 ? labels.nodes.map((l) => l.name) : ["None"];
          break;
        }
      }
      for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k},${v}`);
    return `${groupBy},count\n${rows.join("\n")}`;
  },
});
