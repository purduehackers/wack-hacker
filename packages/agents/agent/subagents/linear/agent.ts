import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Manage Linear issues, projects, initiatives, documents, cycles, labels, teams, and users. " +
    "Use when: the user asks about project management, issues, tickets, sprints, epics, status " +
    "updates, or Linear workspace data.",
  model: "anthropic/claude-sonnet-5",
});
