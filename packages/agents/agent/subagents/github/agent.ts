import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Manage GitHub repositories, issues, pull requests, CI/CD workflows, deployments, code " +
    "browsing, packages, projects, and organization settings. Use when: the user asks about " +
    "GitHub operations, repository management, pull requests, CI/CD, workflows, deployments, or " +
    "code browsing.",
  model: "anthropic/claude-sonnet-5",
});
