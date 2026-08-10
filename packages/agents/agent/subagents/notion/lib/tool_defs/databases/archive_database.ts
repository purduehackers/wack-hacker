import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const archive_database = defineTool({
  description:
    "Archive (soft-delete) a Notion database. The database and its pages become hidden from default views but can be restored from the Notion UI.",
  access: { risk: "destructive" },
  input: z.strictObject({
    database_id: z.string().describe("Database UUID"),
  }),
  execute: async ({ database_id }) => {
    const db = await notion.databases.update({
      database_id,
      in_trash: true,
    });
    return {
      id: db.id,
      archived: "in_trash" in db ? db.in_trash : true,
    };
  },
});
