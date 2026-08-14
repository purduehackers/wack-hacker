import { UpstreamError } from "@repo/shared/errors";
import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

import { env } from "../env.ts";
import { authorizeCoreTool, coreToolFailure, isCoreToolVisible } from "../lib/policy/core-tools.ts";
import { guardToolExecution } from "../lib/serialization.ts";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
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

/** Exa accepts either an ISO calendar date or a full ISO 8601 instant. */
const isoPublishedDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

export const webSearchInputSchema = z.strictObject({
  query: z.string().describe("The search query"),
  numResults: z
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("Number of results to return (default 5, max 10)"),
  type: z
    .enum(["auto", "neural", "keyword"])
    .default("auto")
    .describe("Search type: 'auto' (default), 'neural' for semantic, 'keyword' for exact"),
  category: z
    .enum(EXA_CATEGORIES)
    .optional()
    .describe("Optional Exa data category to focus the search."),
  livecrawl: z
    .enum(["never", "fallback", "always", "auto"])
    .default("auto")
    .describe("Livecrawl strategy (default 'auto')."),
  startPublishedDate: isoPublishedDate
    .optional()
    .describe("Filter results published after this ISO date or date-time"),
  endPublishedDate: isoPublishedDate
    .optional()
    .describe("Filter results published before this ISO date or date-time"),
  includeDomains: z.array(z.string()).optional().describe("Only return results from these domains"),
  excludeDomains: z.array(z.string()).optional().describe("Exclude results from these domains"),
  includeText: z.string().optional().describe("Require this text (max 5 words, single phrase)"),
  excludeText: z.string().optional().describe("Exclude this text (max 5 words, single phrase)"),
});

const exaResultSchema = z.strictObject({
  title: z.string().nullable(),
  url: z.url(),
  publishedDate: z.string().optional(),
  author: z.string().optional(),
  score: z.number().optional(),
  id: z.string(),
  image: z.string().optional(),
  favicon: z.string().optional(),
  summary: z.string().optional(),
  highlights: z.array(z.string()).optional(),
  highlightScores: z.array(z.number()).optional(),
});

const exaResponseSchema = z.strictObject({
  results: z.array(exaResultSchema),
  context: z.string().optional(),
  autopromptString: z.string().optional(),
  autoDate: z.string().optional(),
  requestId: z.string(),
  statuses: z
    .array(z.strictObject({ id: z.string(), status: z.string(), source: z.string() }))
    .optional(),
  costDollars: z
    .strictObject({
      total: z.number(),
      search: z
        .strictObject({ neural: z.number().optional(), keyword: z.number().optional() })
        .optional(),
      contents: z
        .strictObject({
          text: z.number().optional(),
          highlights: z.number().optional(),
          summary: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

/**
 * Runs one Exa search and renders the results as numbered markdown for the
 * model. It throws `UpstreamError` for a missing key, an Exa rejection, or a
 * response that fails schema validation. The caller therefore maps every
 * failure onto one tool-facing shape.
 */
export async function searchWeb(input: z.output<typeof webSearchInputSchema>) {
  if (env.EXA_API_KEY === undefined) {
    throw new UpstreamError({
      service: "Exa",
      status: 503,
      detail: "integration is not configured",
    });
  }

  const response = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: input.query,
      numResults: input.numResults,
      type: input.type,
      ...(input.category && { category: input.category }),
      ...(input.startPublishedDate && { startPublishedDate: input.startPublishedDate }),
      ...(input.endPublishedDate && { endPublishedDate: input.endPublishedDate }),
      ...(input.includeDomains?.length && { includeDomains: input.includeDomains }),
      ...(input.excludeDomains?.length && { excludeDomains: input.excludeDomains }),
      ...(input.includeText && { includeText: [input.includeText] }),
      ...(input.excludeText && { excludeText: [input.excludeText] }),
      contents: {
        livecrawl: input.livecrawl,
        summary: { query: input.query },
        highlights: { numSentences: 3, highlightsPerUrl: 2 },
      },
    }),
  });
  if (!response.ok) {
    throw new UpstreamError({ service: "Exa", status: response.status, detail: "search failed" });
  }

  const parsed = exaResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new UpstreamError({
      service: "Exa",
      status: 502,
      detail: `search response was invalid: ${z.prettifyError(parsed.error)}`,
    });
  }
  if (parsed.data.results.length === 0) return "No results found.";

  return parsed.data.results
    .map((result, index) => {
      const date = result.publishedDate ? ` (${result.publishedDate.slice(0, 10)})` : "";
      const author = result.author ? ` — ${result.author}` : "";
      const summary = result.summary?.trim();
      const highlights = result.highlights?.length ? result.highlights.join(" … ") : "";
      const snippet =
        summary && summary.length > 0 ? summary : highlights || "(no preview available)";
      return `**${index + 1}. ${result.title ?? "Untitled"}**${date}${author}\n${result.url}\n${snippet}`;
    })
    .join("\n\n");
}

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!isCoreToolVisible("web_search", ctx.session.auth.current)) return undefined;
      return defineTool({
        description:
          "Search the web using Exa. Use for current events, external documentation, real-time info, or anything not in the Purdue Hackers knowledge base. Prefer 'neural' type for conceptual queries, 'keyword' for exact lookups.",
        inputSchema: webSearchInputSchema,
        execute: async (input, toolCtx) => {
          return guardToolExecution(async () => {
            const authorization = await authorizeCoreTool("web_search", toolCtx);
            if (!authorization.allowed) return authorization.output;
            try {
              return await searchWeb(input);
            } catch (cause) {
              return coreToolFailure("Exa", cause);
            }
          });
        },
      });
    },
  },
});
