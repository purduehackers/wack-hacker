import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, TEAM } from "../../constants.ts";

export const get_alias = defineTool({
  description: "Retrieve a single alias by id or hostname.",
  access: { risk: "read" },
  input: z.strictObject({
    id_or_alias: z.string(),
    from: epochMillis.optional(),
    projectId: z.string().optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
  }),
  execute: async ({ id_or_alias, ...query }) => {
    const result = await vercel().aliases.getAlias({
      ...TEAM,
      idOrAlias: id_or_alias,
      ...query,
    });
    return JSON.stringify(result);
  },
});
