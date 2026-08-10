import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const archive_page = defineTool({
  description:
    "Archive (soft-delete) a Notion page. Equivalent to update_page with archived=true, but as an explicit intent.",
  access: { risk: "destructive" },
  input: z.strictObject({
    page_id: z.string().describe("Page UUID"),
  }),
  execute: async ({ page_id }) => {
    const page = await notion.pages.update({
      page_id,
      in_trash: true,
    });
    return {
      id: page.id,
      archived: "in_trash" in page ? page.in_trash : true,
    };
  },
});
