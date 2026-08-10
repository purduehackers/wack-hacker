import type { SearchParameters, SearchResponse } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion, richTextToPlain } from "../../client.ts";
import { cursorPaginationInputShape } from "../../shared-constants.ts";

type SearchResult = SearchResponse["results"][number];

/** Extract a title string from an SDK search result (page or data source). */
function extractTitle(result: SearchResult) {
  if ("title" in result) return richTextToPlain(result.title);
  if ("properties" in result) {
    const title = Object.values(result.properties).find((property) => property.type === "title");
    if (title?.type === "title") return richTextToPlain(title.title);
  }
  return "";
}

export const search_notion = defineTool({
  description: `Search the Notion workspace by keyword. Returns matching pages and databases with title, URL, and last edited time. Use type filter to narrow results.`,
  access: { risk: "read" },
  input: z.strictObject({
    query: z.string().describe("Search query"),
    filter: z
      .enum(["page", "data_source"])
      .optional()
      .describe("Filter by object type (page or data_source)"),
    ...cursorPaginationInputShape,
  }),
  execute: async ({ query, filter, page_size, start_cursor }) => {
    const params: SearchParameters = {
      query,
      page_size: page_size ?? 20,
      ...(start_cursor === undefined ? {} : { start_cursor }),
      ...(filter === undefined ? {} : { filter: { value: filter, property: "object" } }),
    };
    const { results, has_more, next_cursor } = await notion.search(params);
    return {
      results: results.map((r) => ({
        id: r.id,
        object: r.object,
        title: extractTitle(r),
        url: "url" in r ? r.url : undefined,
        last_edited_time: "last_edited_time" in r ? r.last_edited_time : undefined,
      })),
      has_more,
      next_cursor,
    };
  },
});
