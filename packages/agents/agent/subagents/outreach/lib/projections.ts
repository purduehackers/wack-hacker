/**
 * @fileoverview The one projection every CRM tool returns for a Notion page.
 *
 * Notion returns three different page response shapes depending on the
 * endpoint. Summarizing them through one projection keeps every CRM tool's
 * output identical regardless of which endpoint produced the page.
 */

import type {
  CreatePageResponse,
  GetPageResponse,
  QueryDataSourceResponse,
} from "@notionhq/client/build/src/api-endpoints";

type CrmPage = QueryDataSourceResponse["results"][number] | GetPageResponse | CreatePageResponse;

/** Compact projection every CRM tool returns for a Notion page. */
export function summarizePage(page: CrmPage) {
  return {
    id: page.id,
    url: "url" in page ? page.url : undefined,
    properties: "properties" in page ? page.properties : undefined,
    created_time: "created_time" in page ? page.created_time : undefined,
    last_edited_time: "last_edited_time" in page ? page.last_edited_time : undefined,
  };
}
