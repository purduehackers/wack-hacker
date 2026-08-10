import type { CreateDatabaseParameters } from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion, richTextToPlain } from "../../client.ts";
import { isCreateDataSourceProperties } from "../../notion-input.ts";

export const create_database = defineTool({
  description: `Create a new database as a child of a page. Requires a title property at minimum. Define the property schema — supported types: title, rich_text, number, select, multi_select, status, date, checkbox, people, url, email, relation.`,
  access: { risk: "write" },
  input: z.strictObject({
    parent_page_id: z.string().describe("Parent page UUID"),
    title: z.string().describe("Database title"),
    properties: z
      .record(z.string(), z.json())
      .describe(
        "Property schema (e.g. { Name: { title: {} }, Status: { select: { options: [...] } } })",
      ),
  }),
  execute: async ({ parent_page_id, title, properties }) => {
    if (!isCreateDataSourceProperties(properties)) {
      return { error: "Invalid Notion data-source property schema (a title property is required)" };
    }
    const params: CreateDatabaseParameters = {
      parent: { type: "page_id", page_id: parent_page_id },
      title: [{ text: { content: title } }],
      initial_data_source: { properties },
    };

    const db = await notion.databases.create(params);
    return {
      id: db.id,
      url: "url" in db ? db.url : undefined,
      title: "title" in db ? richTextToPlain(db.title) : title,
    };
  },
});
