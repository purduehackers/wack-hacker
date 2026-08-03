import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Answer questions from the Purdue Hackers knowledge base at ask.purduehackers.com — events, " +
    "projects, documentation, history, culture, and organizational info. Use when: the user asks " +
    "a factual question about Purdue Hackers itself rather than asking for an action to be taken.",
  model: "anthropic/claude-sonnet-5",
});
