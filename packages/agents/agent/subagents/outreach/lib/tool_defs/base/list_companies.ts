import type { QueryDataSourceParameters } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { COMPANIES_DATA_SOURCE_ID, summarizePage } from "../../constants.ts";
import { isQueryFilter, isQuerySorts } from "../../notion-input.ts";
import { crmQueryInputShape } from "../../shared-constants.ts";

export const list_companies = defineTool({
  description: `List Company pages in the CRM. Supports Notion filters/sorts against the Companies data source. Call retrieve_crm_schema first to get the exact property names and select options.`,
  access: { risk: "read" },
  requires: "NOTION_TOKEN",
  input: z.strictObject({
    ...crmQueryInputShape,
    filter: crmQueryInputShape.filter.describe(
      "Notion filter object targeting the Companies schema",
    ),
  }),
  execute: async ({ filter, sorts, page_size, start_cursor }) => {
    if (filter !== undefined && !isQueryFilter(filter)) {
      return { error: "Invalid Notion CRM filter" };
    }
    if (sorts !== undefined && !isQuerySorts(sorts)) {
      return { error: "Invalid Notion CRM sorts" };
    }
    const params: QueryDataSourceParameters = {
      data_source_id: COMPANIES_DATA_SOURCE_ID,
      ...(filter === undefined ? {} : { filter }),
      ...(sorts === undefined ? {} : { sorts }),
      page_size: page_size ?? 25,
      ...(start_cursor === undefined ? {} : { start_cursor }),
    };
    const result = await notion.dataSources.query(params);
    return {
      results: result.results.map((p) => summarizePage(p)),
      has_more: result.has_more,
      next_cursor: result.next_cursor,
    };
  },
});
