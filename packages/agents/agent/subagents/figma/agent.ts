import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Browse and manage Figma files, components, styles, variables, comments, and webhooks. Use " +
    "when: the user asks about Figma designs, files, components, styles, design tokens, " +
    "variables, comments, or dev resources.",
  model: "anthropic/claude-sonnet-5",
});
