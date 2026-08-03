import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Monitor errors, inspect events and stack traces, manage releases, review performance, and " +
    "configure alerts across Sentry projects. Use when: the user asks about errors, exceptions, " +
    "crashes, Sentry issues, releases, deploys, alerts, error monitoring, or application " +
    "performance.",
  model: "anthropic/claude-sonnet-5",
});
