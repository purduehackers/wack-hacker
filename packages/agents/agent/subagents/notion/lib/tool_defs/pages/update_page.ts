import type { UpdatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { parseCover, parseIcon } from "../../constants.ts";
import { isUpdatePageProperties } from "../../notion-input.ts";

export const update_page = defineTool({
  description: `Update a page's properties, icon, cover, or archived status. Only include fields to change. For database entries, properties must match the database schema. Set archived: true to soft-delete.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    page_id: z.string().describe("Page UUID"),
    properties: z
      .record(z.string(), z.json())
      .optional()
      .describe("Properties to update (Notion property format)"),
    icon: z.string().optional().describe("Emoji or external URL for page icon"),
    cover: z.url().optional().describe("External URL for page cover image"),
    archived: z.boolean().optional().describe("Set true to archive (soft-delete)"),
  }),
  execute: async ({ page_id, properties, icon, cover, archived }) => {
    if (properties !== undefined && !isUpdatePageProperties(properties)) {
      return { error: "Invalid Notion page property update" };
    }
    const parsedIcon = parseIcon(icon);
    const parsedCover = parseCover(cover);
    const params: UpdatePageParameters = {
      page_id,
      ...(properties === undefined ? {} : { properties }),
      ...(archived === undefined ? {} : { in_trash: archived }),
      ...(parsedIcon === undefined ? {} : { icon: parsedIcon }),
      ...(parsedCover === undefined ? {} : { cover: parsedCover }),
    };

    const page = await notion.pages.update(params);
    return {
      id: page.id,
      url: "url" in page ? page.url : undefined,
      last_edited_time: "last_edited_time" in page ? page.last_edited_time : undefined,
    };
  },
});
