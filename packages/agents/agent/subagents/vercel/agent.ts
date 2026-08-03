import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Operate the Vercel platform for Purdue Hackers — inspect projects and deployments, read " +
    "runtime logs, manage env vars and aliases, provision marketplace integrations, and control " +
    "rolling releases, firewall, edge config, feature flags, and sandboxes. Use when: the user " +
    "asks about Vercel projects, deployments, env vars, domains, runtime logs, rolling releases, " +
    "edge config, feature flags, sandboxes, firewall, integrations, or platform-level operations " +
    "on Vercel.",
  model: "anthropic/claude-sonnet-5",
});
