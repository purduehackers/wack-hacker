import { UpstreamError } from "@repo/shared/errors";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";

const grepAppResponseSchema = z.looseObject({
  facets: z.looseObject({ count: z.number().optional() }).optional(),
  hits: z
    .looseObject({
      hits: z
        .array(
          z.looseObject({
            repo: z.looseObject({ raw: z.string().optional() }).optional(),
            path: z.looseObject({ raw: z.string().optional() }).optional(),
            content: z.looseObject({ snippet: z.string().optional() }).optional(),
            total_matches: z.looseObject({ raw: z.number().optional() }).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export const search_code = defineTool({
  description:
    "Search code across purduehackers repositories using grep.app. Returns matching file paths, code snippets with line numbers, and repository info. Supports language and path filters.",
  access: { risk: "read" },
  input: z.strictObject({
    query: z.string().describe("Code search query (e.g. 'useState', 'import express')"),
    language: z
      .string()
      .optional()
      .describe("Programming language filter (e.g. 'TypeScript', 'Python')"),
    repo: z
      .string()
      .optional()
      .describe("Specific repo in owner/repo format (e.g. 'purduehackers/my-repo')"),
    path: z.string().optional().describe("Directory path filter (e.g. 'src/components')"),
  }),
  execute: async ({ query, language, repo, path }) => {
    const params = new URLSearchParams({ q: query });
    if (language) params.set("f.lang", language);
    if (repo) params.set("f.repo", repo);
    else params.set("f.repo", `purduehackers`);
    if (path) params.set("f.path", path);

    const response = await fetch(`https://grep.app/api/search?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      if (response.status === 429) return "Code search rate limited. Try again in a moment.";
      return `Code search failed (${response.status}).`;
    }

    const parsed = grepAppResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new UpstreamError({
        service: "grep.app",
        status: 502,
        detail: `invalid response: ${z.prettifyError(parsed.error)}`,
      });
    }
    const data = parsed.data;

    const matches = data.hits?.hits ?? [];
    if (matches.length === 0) return "No code matches found.";

    const results = matches.slice(0, 10).map((match) => ({
      repo: match.repo?.raw,
      path: match.path?.raw,
      matches: match.total_matches?.raw,
      snippet: match.content?.snippet
        ?.replace(/<\/?mark>/g, "")
        ?.replace(/<[^>]+>/g, "")
        ?.trim(),
    }));

    return JSON.stringify({
      total: data.facets?.count ?? results.length,
      results,
    });
  },
});
