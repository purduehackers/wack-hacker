import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_alias = defineTool({
  description: "Delete an alias by id or hostname.",
  access: { risk: "destructive" },
  input: z.strictObject({ id_or_alias: z.string() }),
  execute: async ({ id_or_alias }) => {
    const result = await vercel().aliases.deleteAlias({ ...TEAM, aliasId: id_or_alias });
    return JSON.stringify(result);
  },
});
