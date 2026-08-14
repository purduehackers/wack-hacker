import type { CreatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion, resolveDataSourceId } from "../../client.ts";
import { isCreatePageProperties } from "../../notion-input.ts";
import { parseCover, parseIcon } from "../../page-decoration.ts";

export const create_page = defineTool({
  description: `Create a new Notion page. Can be a subpage of another page, or a new entry in a database. Pass markdown for the page body — the first # heading becomes the title if properties.title is omitted. For database entries, set properties matching the database schema (use retrieve_database first).`,
  access: { risk: "write" },
  input: z.strictObject({
    parent_type: z.enum(["page_id", "database_id"]).describe("Parent type"),
    parent_id: z.string().describe("Parent page or database UUID"),
    properties: z
      .record(z.string(), z.json())
      .optional()
      .describe("Page properties (Notion property format)"),
    markdown: z.string().optional().describe("Page body content as markdown"),
    icon: z.string().optional().describe("Emoji or external URL for page icon"),
    cover: z.url().optional().describe("External URL for page cover image"),
  }),
  execute: async ({ parent_type, parent_id, properties, markdown, icon, cover }) => {
    const pageProperties = properties ?? {};
    if (!isCreatePageProperties(pageProperties)) {
      return { error: "Invalid Notion page properties" };
    }
    const parent: NonNullable<CreatePageParameters["parent"]> =
      parent_type === "page_id"
        ? { type: "page_id", page_id: parent_id }
        : { type: "data_source_id", data_source_id: await resolveDataSourceId(parent_id) };
    const parsedIcon = parseIcon(icon);
    const parsedCover = parseCover(cover);
    const params: CreatePageParameters = {
      parent,
      properties: pageProperties,
      ...(markdown !== undefined && { markdown }),
      ...(parsedIcon !== undefined && { icon: parsedIcon }),
      ...(parsedCover !== undefined && { cover: parsedCover }),
    };

    const page = await notion.pages.create(params);
    return {
      id: page.id,
      url: "url" in page ? page.url : undefined,
      created_time: "created_time" in page ? page.created_time : undefined,
    };
  },
});
