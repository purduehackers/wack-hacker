import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const update_page_content = defineTool({
  description: `Update a page's body content using markdown. Two modes: "replace_content" replaces the entire page body, or "update_content" does search-and-replace on specific text. Use read_page_content first to see current content.`,
  access: { risk: "write" },
  input: z.strictObject({
    page_id: z.string().describe("Page UUID"),
    mode: z
      .enum(["replace_content", "update_content"])
      .describe("Replace entire body or search-and-replace"),
    new_content: z.string().optional().describe("Full markdown content (for replace_content mode)"),
    old_str: z.string().optional().describe("Text to find (for update_content mode)"),
    new_str: z.string().optional().describe("Replacement text (for update_content mode)"),
  }),
  execute: async ({ page_id, mode, new_content, old_str, new_str }) => {
    const params: Parameters<typeof notion.pages.updateMarkdown>[0] =
      mode === "replace_content"
        ? {
            page_id,
            type: "replace_content",
            replace_content: { new_str: new_content ?? "" },
          }
        : {
            page_id,
            type: "update_content",
            update_content: {
              content_updates: [{ old_str: old_str ?? "", new_str: new_str ?? "" }],
            },
          };

    const result = await notion.pages.updateMarkdown(params);
    return { markdown: result.markdown, truncated: result.truncated };
  },
});
