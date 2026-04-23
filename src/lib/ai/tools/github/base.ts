import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../env.ts";
import { paginationInputShape } from "../_shared/constants.ts";
import { octokit } from "./client.ts";

/** List repositories in the purduehackers organization with optional filters. */
export const list_repositories = tool({
  description:
    "List repositories in the purduehackers org. Returns name, description, language, URL, and activity dates. Supports filtering by type and sorting.",
  inputSchema: z.object({
    type: z.enum(["all", "public", "private", "forks", "sources", "member"]).optional(),
    sort: z.enum(["created", "updated", "pushed", "full_name"]).optional(),
    ...paginationInputShape,
  }),
  execute: async ({ type, sort, per_page, page }) => {
    const { data } = await octokit.rest.repos.listForOrg({
      org: env.GITHUB_ORG,
      type: type ?? "all",
      sort: sort ?? "updated",
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((r) => ({
        name: r.name,
        full_name: r.full_name,
        description: r.description,
        private: r.private,
        html_url: r.html_url,
        language: r.language,
        default_branch: r.default_branch,
        updated_at: r.updated_at,
        stargazers_count: r.stargazers_count,
        open_issues_count: r.open_issues_count,
        archived: r.archived,
      })),
    );
  },
});

/** Get full details for a single repository by name. */
export const get_repository = tool({
  description:
    "Get full details for a repository — description, branches, topics, visibility, license, issue/wiki/pages status, and URLs.",
  inputSchema: z.object({
    repo: z.string().describe("Repository name (e.g. 'my-repo')"),
  }),
  execute: async ({ repo }) => {
    const { data } = await octokit.rest.repos.get({
      owner: env.GITHUB_ORG,
      repo,
    });
    return JSON.stringify({
      name: data.name,
      full_name: data.full_name,
      description: data.description,
      private: data.private,
      html_url: data.html_url,
      language: data.language,
      default_branch: data.default_branch,
      created_at: data.created_at,
      updated_at: data.updated_at,
      pushed_at: data.pushed_at,
      stargazers_count: data.stargazers_count,
      forks_count: data.forks_count,
      open_issues_count: data.open_issues_count,
      archived: data.archived,
      topics: data.topics,
      visibility: data.visibility,
      license: data.license?.spdx_id,
      has_issues: data.has_issues,
      has_wiki: data.has_wiki,
      has_pages: data.has_pages,
    });
  },
});

/** Search code across all purduehackers repos using grep.app for fast, accurate results with snippets. */
export const search_code = tool({
  description:
    "Search code across purduehackers repositories using grep.app. Returns matching file paths, code snippets with line numbers, and repository info. Supports language and path filters.",
  inputSchema: z.object({
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

    const response = await fetch(`https://grep.app/api/search?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      if (response.status === 429) return "Code search rate limited. Try again in a moment.";
      return `Code search failed (${response.status}).`;
    }

    const data = (await response.json()) as {
      facets?: { count?: number };
      hits?: {
        hits?: Array<{
          repo?: { raw?: string };
          path?: { raw?: string };
          content?: { snippet?: string };
          total_matches?: { raw?: number };
        }>;
      };
    };

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

/** Search issues and pull requests across purduehackers repositories. */
export const search_issues = tool({
  description:
    "Search issues and pull requests across purduehackers repos. Supports GitHub search qualifiers like 'is:open', 'is:pr', 'label:bug', 'is:merged'. Returns number, title, state, URL, labels, and dates.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Search query with GitHub qualifiers (e.g. 'bug is:open', 'is:pr is:merged')"),
    sort: z.enum(["created", "updated", "comments"]).optional(),
    order: z.enum(["asc", "desc"]).optional(),
    ...paginationInputShape,
  }),
  execute: async ({ query, sort, order, per_page, page }) => {
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: `${query} org:${env.GITHUB_ORG}`,
      sort,
      order,
      per_page: per_page ?? 20,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      items: data.items.map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        html_url: i.html_url,
        user: i.user?.login,
        labels: i.labels.map((l) => (typeof l === "string" ? l : l.name)),
        created_at: i.created_at,
        updated_at: i.updated_at,
        is_pull_request: !!i.pull_request,
      })),
    });
  },
});
