import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { firstDataSourceId, notion, richTextToPlain } from "../../client.ts";

export const retrieve_database = defineTool({
  description: `Get a database's schema — title, property definitions (types, options), and URL. Always call this before querying or creating entries to understand the schema.`,
  access: { risk: "read" },
  input: z.strictObject({
    database_id: z.string().describe("Database UUID or URL"),
  }),
  execute: async ({ database_id }) => {
    const db = await notion.databases.retrieve({ database_id });
    if (!("url" in db)) return { id: db.id };
    const dataSource = await notion.dataSources.retrieve({
      data_source_id: firstDataSourceId(db),
    });
    return {
      id: db.id,
      title: richTextToPlain(db.title),
      url: db.url,
      properties: "properties" in dataSource ? dataSource.properties : undefined,
      parent: db.parent,
      data_source_id: dataSource.id,
    };
  },
});
