import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Autonomously make code changes to a Purdue Hackers repository in an isolated sandbox — edit " +
    "files, run checks, iterate until verified. Use when: the user asks to fix a bug, implement a " +
    "feature, refactor code, update configs, write tests, bump versions, or make any substantive " +
    "change to a purduehackers repository.",
  model: "anthropic/claude-sonnet-5",
});
