import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const search_entities = defineTool({
  description:
    "Search Linear entities by keyword. Use for finding issues, projects, documents, initiatives, users, teams, customers, or labels. Returns IDs, names/identifiers, and URLs. Use entityType 'User' to resolve a person's name to their Linear user ID.",
  access: { risk: "read" },
  input: z.strictObject({
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
        return JSON.stringify(
          r.nodes.map((i) => ({
            id: i.id,
            identifier: i.identifier,
            title: i.title,
            url: i.url,
          })),
        );
      }
      case "Project": {
        const r = await linear.searchProjects(query);
        return JSON.stringify(r.nodes.map((p) => ({ id: p.id, name: p.name, url: p.url })));
      }
      case "Document": {
        const r = await linear.searchDocuments(query);
        return JSON.stringify(r.nodes.map((d) => ({ id: d.id, title: d.title, url: d.url })));
      }
      case "Initiative": {
        const r = await linear.initiatives();
        return JSON.stringify(
          r.nodes
            .filter(
              (i) => i.name.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q),
            )
            .map((i) => ({ id: i.id, name: i.name, status: i.status, url: i.url })),
        );
      }
      case "User": {
        const r = await linear.users();
        return JSON.stringify(
          r.nodes
            .filter((u) => u.name.toLowerCase().includes(q))
            .map((u) => ({ id: u.id, name: u.name, email: u.email })),
        );
      }
      case "Team": {
        const r = await linear.teams();
        return JSON.stringify(
          r.nodes
            .filter((t) => t.name.toLowerCase().includes(q) || t.key.toLowerCase().includes(q))
            .map((t) => ({ id: t.id, name: t.name, key: t.key })),
        );
      }
      case "Customer": {
        const r = await linear.customers();
        return JSON.stringify(
          r.nodes
            .filter((c) => c.name.toLowerCase().includes(q))
            .map((c) => ({ id: c.id, name: c.name })),
        );
      }
      case "IssueLabel": {
        const r = await linear.issueLabels();
        return JSON.stringify(
          r.nodes
            .filter((l) => l.name.toLowerCase().includes(q))
            .map((l) => ({ id: l.id, name: l.name })),
        );
      }
    }
  },
});
