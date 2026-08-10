import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, paginationInputShape } from "../../constants.ts";

/**
 * The issue search endpoint returns a label as either a bare name or a label
 * object, so the two shapes are decoded rather than branched on at runtime. A
 * label we cannot read is dropped instead of failing the whole search.
 */
const issueLabelNameSchema = z
  .union([z.string(), z.looseObject({ name: z.string().optional() }).transform((l) => l.name)])
  .catch(undefined);

export const search_issues = defineTool({
  description:
    "Search issues and pull requests across purduehackers repos. Supports GitHub search qualifiers like 'is:open', 'is:pr', 'label:bug', 'is:merged'. Returns number, title, state, URL, labels, and dates.",
  access: { risk: "read" },
  input: z.strictObject({
    query: z
      .string()
      .describe("Search query with GitHub qualifiers (e.g. 'bug is:open', 'is:pr is:merged')"),
    sort: z.enum(["created", "updated", "comments"]).optional(),
    order: z.enum(["asc", "desc"]).optional(),
    ...paginationInputShape,
  }),
  execute: async ({ query, sort, order, per_page, page }) => {
    const { data } = await octokit().rest.search.issuesAndPullRequests({
      q: `${query} org:${env.GITHUB_ORG}`,
      ...(sort === undefined ? {} : { sort }),
      ...(order === undefined ? {} : { order }),
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
        labels: i.labels.map((label) => issueLabelNameSchema.parse(label)),
        created_at: i.created_at,
        updated_at: i.updated_at,
        is_pull_request: !!i.pull_request,
      })),
    });
  },
});
