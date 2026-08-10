import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const retrieve_page = defineTool({
  description: `Get a page's properties and metadata — title, URL, parent, timestamps, icon, cover, and all property values. Use to inspect a page before modifying it.`,
  access: { risk: "read" },
  input: z.strictObject({
    page_id: z.string().describe("Page UUID or URL"),
  }),
  execute: async ({ page_id }) => {
    const page = await notion.pages.retrieve({ page_id });
    if (!("url" in page)) return { id: page.id };
    return {
      id: page.id,
      url: page.url,
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
      parent: page.parent,
      icon: page.icon,
      cover: page.cover,
      archived: page.archived,
      properties: page.properties,
    };
  },
});
