import Exa from "exa-js";
import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../env.ts";

export const web_search = tool({
  description:
    "Search the web using Exa. Use for current events, external documentation, real-time info, or anything not in the Purdue Hackers knowledge base. Prefer 'neural' type for conceptual queries, 'keyword' for exact lookups.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    numResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(5)
      .describe("Number of results to return (default 5, max 10)"),
    type: z
      .enum(["auto", "neural", "keyword"])
      .optional()
      .default("auto")
      .describe(
        "Search type: 'auto' (default), 'neural' for semantic, 'keyword' for exact",
      ),
    startPublishedDate: z
      .string()
      .optional()
      .describe(
        "Filter results published after this ISO date (e.g. '2024-01-01T00:00:00Z')",
      ),
    endPublishedDate: z
      .string()
      .optional()
      .describe("Filter results published before this ISO date"),
    includeDomains: z
      .array(z.string())
      .optional()
      .describe(
        "Only return results from these domains (e.g. ['github.com', 'docs.example.com'])",
      ),
  }),
  execute: async ({
    query,
    numResults,
    type,
    startPublishedDate,
    endPublishedDate,
    includeDomains,
  }) => {
    try {
      const exa = new Exa(env.EXA_API_KEY);
      const response = await exa.searchAndContents(query, {
        numResults,
        type,
        ...(startPublishedDate && { startPublishedDate }),
        ...(endPublishedDate && { endPublishedDate }),
        ...(includeDomains?.length && { includeDomains }),
        text: { maxCharacters: 2000 },
        highlights: { numSentences: 3, highlightsPerUrl: 2 },
      });

      if (!response.results.length) {
        return "No results found.";
      }

      return response.results
        .map((r, i) => {
          const date = r.publishedDate ? ` (${r.publishedDate.slice(0, 10)})` : "";
          const snippet =
            r.highlights && r.highlights.length > 0
              ? r.highlights.join(" … ")
              : r.text
                ? r.text.slice(0, 400)
                : "(no preview available)";
          return `**${i + 1}. ${r.title ?? "Untitled"}**${date}\n${r.url}\n${snippet}`;
        })
        .join("\n\n");
    } catch (e) {
      return `Web search failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});
