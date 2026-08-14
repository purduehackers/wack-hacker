import type { QueryDataSourceParameters } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion, resolveDataSourceId } from "../../client.ts";
import { isQueryFilter, isQuerySorts } from "../../notion-input.ts";
import { cursorPaginationInputShape, notionSortSchema } from "../../shared-constants.ts";

export const query_database = defineTool({
  description: `Query a database with optional filters and sorts. Returns matching pages with their properties. Always call retrieve_database first to understand the schema before building filters. Supports pagination via start_cursor.`,
  access: { risk: "read" },
  input: z.strictObject({
    database_id: z.string().describe("Database UUID"),
    filter: z
      .record(z.string(), z.json())
      .optional()
      .describe("Notion filter object (see skill guidance for syntax)"),
    sorts: z.array(notionSortSchema).optional(),
    ...cursorPaginationInputShape,
  }),
  execute: async ({ database_id, filter, sorts, page_size, start_cursor }) => {
    if (filter !== undefined && !isQueryFilter(filter)) {
      return { error: "Invalid Notion database filter" };
    }
    if (sorts !== undefined && !isQuerySorts(sorts)) {
      return { error: "Invalid Notion database sorts" };
    }
    const dataSourceId = await resolveDataSourceId(database_id);
    const params: QueryDataSourceParameters = {
      data_source_id: dataSourceId,
      ...(filter !== undefined && { filter }),
      ...(sorts !== undefined && { sorts }),
      page_size: page_size ?? 25,
      ...(start_cursor !== undefined && { start_cursor }),
    };

    const result = await notion.dataSources.query(params);
    return {
      results: result.results.map((page) => ({
        id: page.id,
        url: "url" in page ? page.url : undefined,
        properties: "properties" in page ? page.properties : undefined,
        created_time: "created_time" in page ? page.created_time : undefined,
        last_edited_time: "last_edited_time" in page ? page.last_edited_time : undefined,
      })),
      has_more: result.has_more,
      next_cursor: result.next_cursor,
    };
  },
});
