import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { cursorPaginationInputShape } from "../../shared-constants.ts";

export const retrieve_page_property = defineTool({
  description: `Get a single property value from a page, with pagination for large values (relations, rollups, rich_text). Use retrieve_page first to see all property IDs.`,
  access: { risk: "read" },
  input: z.strictObject({
    page_id: z.string().describe("Page UUID"),
    property_id: z.string().describe("Property ID (from retrieve_page results)"),
    ...cursorPaginationInputShape,
  }),
  execute: async ({ page_id, property_id, start_cursor, page_size }) => {
    return await notion.pages.properties.retrieve({
      page_id,
      property_id,
      ...(start_cursor !== undefined && { start_cursor }),
      page_size: page_size ?? 25,
    });
  },
});
