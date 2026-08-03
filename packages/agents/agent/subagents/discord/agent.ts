import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Manage the Discord server — channels, roles, members, messages, webhooks, scheduled events, " +
    "threads, and emojis. Use when: the user asks about server management, channels, roles, " +
    "members, messages, webhooks, events, threads, or emojis.",
  model: "anthropic/claude-sonnet-5",
});
