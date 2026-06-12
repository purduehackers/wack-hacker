import { tool } from "ai";
import Exa from "exa-js";
import { z } from "zod";

import { env } from "../../../../env.ts";

const EXA_CATEGORIES = [
  "company",
  "research paper",
  "news",
  "pdf",
  "github",
  "tweet",
  "personal site",
  "linkedin profile",
] as const;

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
      .describe("Search type: 'auto' (default), 'neural' for semantic, 'keyword' for exact"),
    category: z
      .enum(EXA_CATEGORIES)
      .optional()
      .describe(
        "Optional Exa data category to focus the search (e.g. 'news', 'research paper', 'github').",
      ),
    livecrawl: z
      .enum(["never", "fallback", "always", "auto"])
      .optional()
      .default("auto")
      .describe(
        "Livecrawl strategy: 'auto' (default), 'always' for fresh fetches, 'fallback' to crawl only when cache is empty, 'never' to skip livecrawling.",
      ),
    startPublishedDate: z
      .string()
      .optional()
      .describe("Filter results published after this ISO date (e.g. '2024-01-01T00:00:00Z')"),
    endPublishedDate: z
      .string()
      .optional()
      .describe("Filter results published before this ISO date"),
    includeDomains: z
      .array(z.string())
      .optional()
      .describe("Only return results from these domains (e.g. ['github.com', 'docs.example.com'])"),
    excludeDomains: z.array(z.string()).optional().describe("Exclude results from these domains."),
    includeText: z
      .string()
      .optional()
      .describe("Require results to contain this text (max 5 words, single phrase)."),
    excludeText: z
      .string()
      .optional()
      .describe("Exclude results that contain this text (max 5 words, single phrase)."),
  }),
  execute: async ({
    query,
    numResults,
    type,
    category,
    livecrawl,
    startPublishedDate,
    endPublishedDate,
    includeDomains,
    excludeDomains,
    includeText,
    excludeText,
  }) => {
    try {
      const exa = new Exa(env.EXA_API_KEY);
      const response = await exa.searchAndContents(query, {
        numResults,
        type,
        livecrawl,
        ...(category && { category }),
        ...(startPublishedDate && { startPublishedDate }),
        ...(endPublishedDate && { endPublishedDate }),
        ...(includeDomains?.length && { includeDomains }),
        ...(excludeDomains?.length && { excludeDomains }),
        ...(includeText && { includeText: [includeText] }),
        ...(excludeText && { excludeText: [excludeText] }),
        summary: { query },
        highlights: { numSentences: 3, highlightsPerUrl: 2 },
      });

      if (!response.results.length) {
        return "No results found.";
      }

      return response.results
        .map((r, i) => {
          const date = r.publishedDate ? ` (${r.publishedDate.slice(0, 10)})` : "";
          const author = r.author ? ` — ${r.author}` : "";
          const summary = r.summary?.trim();
          const highlights =
            r.highlights && r.highlights.length > 0 ? r.highlights.join(" … ") : "";
          const snippet =
            summary && summary.length > 0 ? summary : highlights || "(no preview available)";
          return `**${i + 1}. ${r.title ?? "Untitled"}**${date}${author}\n${r.url}\n${snippet}`;
        })
        .join("\n\n");
    } catch (e) {
      return `Web search failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
});
