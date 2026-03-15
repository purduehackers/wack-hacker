import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../env";

const PHACK_ASK_URL = "https://ask.purduehackers.com/api/query";

/** Queries the Purdue Hackers knowledge base at ask.purduehackers.com. */
export const documentation = tool({
  description:
    "Ask a question about Purdue Hackers — events, projects, documentation, history, culture, and organizational info.",
  inputSchema: z.object({
    prompt: z.string().describe("The question to ask about Purdue Hackers"),
  }),
  execute: async ({ prompt }) => {
    const response = await fetch(PHACK_ASK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PHACK_ASK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      return `Knowledge base query failed (${response.status}). Try rephrasing the question.`;
    }

    const data = await response.json();
    return typeof data === "string" ? data : JSON.stringify(data);
  },
});
