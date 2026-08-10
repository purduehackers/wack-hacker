import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const read_page_content = defineTool({
  description: `Read a page's full body content as markdown. Returns the complete page content including headings, lists, code blocks, etc. Use this to see what's on a page before editing.`,
  access: { risk: "read" },
  input: z.strictObject({
    page_id: z.string().describe("Page UUID"),
  }),
  execute: async ({ page_id }) => {
    const result = await notion.pages.retrieveMarkdown({ page_id });
    return { markdown: result.markdown, truncated: result.truncated };
  },
});
