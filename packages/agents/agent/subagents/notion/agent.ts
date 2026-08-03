import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Manage the Notion workspace — pages, databases, and comments. Use when: the user asks about " +
    "direct Notion operations — creating or editing pages, querying databases, reading content, " +
    "or managing comments.",
  model: "anthropic/claude-sonnet-5",
});
