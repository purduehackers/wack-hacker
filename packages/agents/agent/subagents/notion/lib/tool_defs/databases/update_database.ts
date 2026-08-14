import type {
  UpdateDatabaseParameters,
  UpdateDataSourceParameters,
} from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { firstDataSourceId, notion, richTextToPlain } from "../../client.ts";
import { isUpdateDataSourceProperties } from "../../notion-input.ts";

export const update_database = defineTool({
  description: `Update a database's title or property schema. To add a property, include it in properties. To rename, use the property ID as the key. To delete, set the property to null.`,
  access: { risk: "write" },
  input: z.strictObject({
    database_id: z.string().describe("Database UUID"),
    title: z.string().optional().describe("New database title"),
    properties: z
      .record(z.string(), z.json())
      .optional()
      .describe("Properties to add, update, or remove (set to null)"),
  }),
  execute: async ({ database_id, title, properties }) => {
    if (properties !== undefined && !isUpdateDataSourceProperties(properties)) {
      return { error: "Invalid Notion data-source property update" };
    }
    const current = await notion.databases.retrieve({ database_id });
    if (properties !== undefined) {
      const dataSourceParams: UpdateDataSourceParameters = {
        data_source_id: firstDataSourceId(current),
        properties,
      };
      await notion.dataSources.update(dataSourceParams);
    }
    const databaseParams: UpdateDatabaseParameters = {
      database_id,
      ...(title !== undefined && { title: [{ text: { content: title } }] }),
    };
    if (title !== undefined) await notion.databases.update(databaseParams);
    const db = await notion.databases.retrieve({ database_id });
    return {
      id: db.id,
      url: "url" in db ? db.url : undefined,
      title: "title" in db ? richTextToPlain(db.title) : title,
    };
  },
});
