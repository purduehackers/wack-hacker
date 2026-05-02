import { tool } from "ai";
import { z } from "zod";

import { getExa } from "./client.ts";

/**
 * Maximum URLs accepted per `web_get_contents` call. Keeps the response
 * size bounded and prevents the model from issuing huge crawl jobs.
 */
const MAX_GET_CONTENTS_URLS = 5;

/** Live web search via Exa. Returns titles, URLs, summaries, and excerpts. */
export const web_search = tool({
  description:
    "Search the web for up-to-date information using Exa's neural search. Use this for current events, documentation, technical topics, or any question that benefits from live web results. Returns titles, URLs, summaries, and relevant text excerpts.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    num_results: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Number of results to return (default 5)"),
    search_type: z
      .enum(["auto", "keyword", "neural"])
      .optional()
      .describe(
        "Search type: 'neural' for semantic/conceptual search, 'keyword' for exact terms, 'auto' to let Exa decide (default: auto)",
      ),
    include_text: z
      .boolean()
      .optional()
      .describe("Whether to include full text excerpts from pages (default true)"),
    livecrawl: z
      .enum(["always", "fallback", "never"])
      .optional()
      .describe(
        "Live crawl mode: 'always' fetches fresh content, 'fallback' uses live crawl when index is stale, 'never' uses index only (default: fallback)",
      ),
  }),
  execute: async ({
    query,
    num_results = 5,
    search_type = "auto",
    include_text = true,
    livecrawl = "fallback",
  }) => {
    // Always pass `text` and `highlights` so Exa's generic types narrow the
    // result shape; gate the visible body on `include_text` to keep the
    // returned excerpt size bounded when the caller doesn't want it.
    const result = await getExa().searchAndContents(query, {
      type: search_type,
      numResults: num_results,
      livecrawl,
      text: { maxCharacters: include_text ? 800 : 0 },
      highlights: { numSentences: 2, highlightsPerUrl: 2 },
      summary: true,
    });

    if (!result.results.length) {
      return "No results found.";
    }

    return result.results
      .map((r, i) => {
        const title = r.title ?? "(untitled)";
        const lines: string[] = [`${i + 1}. **${title}** — ${r.url}`];
        if (r.publishedDate) lines.push(`   Published: ${r.publishedDate}`);
        if (r.summary) lines.push(`   Summary: ${r.summary}`);
        if (r.highlights.length) lines.push(`   Highlights: ${r.highlights.join(" … ")}`);
        else if (include_text && r.text) lines.push(`   Excerpt: ${r.text.slice(0, 400)}…`);
        return lines.join("\n");
      })
      .join("\n\n");
  },
});

/** Fetch full page contents for specific URLs via Exa. */
export const web_get_contents = tool({
  description:
    "Fetch the full text contents of specific web pages by URL using Exa. Use after `web_search` when a snippet isn't enough, or when the user supplies URLs directly. Accepts up to 5 URLs per call.",
  inputSchema: z.object({
    urls: z
      .array(z.string().url())
      .min(1)
      .max(MAX_GET_CONTENTS_URLS)
      .describe(`The URLs to fetch (1-${MAX_GET_CONTENTS_URLS}).`),
    max_characters: z
      .number()
      .int()
      .min(200)
      .max(8000)
      .optional()
      .describe("Maximum characters of page text to return per URL (default 4000)."),
    livecrawl: z
      .enum(["always", "fallback", "never"])
      .optional()
      .describe(
        "Live crawl mode: 'always' fetches fresh content, 'fallback' uses live crawl when index is stale, 'never' uses index only (default: fallback)",
      ),
  }),
  execute: async ({ urls, max_characters = 4000, livecrawl = "fallback" }) => {
    const result = await getExa().getContents(urls, {
      text: { maxCharacters: max_characters },
      summary: true,
      livecrawl,
    });

    if (!result.results.length) {
      return "No contents found for the supplied URLs.";
    }

    return result.results
      .map((r, i) => {
        const title = r.title ?? "(untitled)";
        const lines: string[] = [`${i + 1}. **${title}** — ${r.url}`];
        if (r.publishedDate) lines.push(`   Published: ${r.publishedDate}`);
        if (r.author) lines.push(`   Author: ${r.author}`);
        if (r.summary) lines.push(`   Summary: ${r.summary}`);
        if (r.text) lines.push(`   Content:\n${r.text}`);
        return lines.join("\n");
      })
      .join("\n\n---\n\n");
  },
});
