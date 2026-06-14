import { z } from "zod";

import { env } from "../../../../env.ts";
import { defineTool } from "../_shared/define-tool.ts";

const PHACK_ASK_URL = "https://ask.purduehackers.com/api/query";

/** Queries the Purdue Hackers knowledge base at ask.purduehackers.com. */
export const documentation = defineTool({
  name: "documentation",
  domain: "core",
  description:
    "Ask a question about Purdue Hackers — events, projects, documentation, history, culture, and organizational info.",
  access: { risk: "read", minRole: "public" },
  input: z.object({
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
