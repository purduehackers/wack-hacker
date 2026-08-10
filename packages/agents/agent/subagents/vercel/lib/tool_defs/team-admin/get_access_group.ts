import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_access_group = defineTool({
  description: "Retrieve an access group by id or name.",
  access: { risk: "read" },
  input: z.strictObject({ access_group_id_or_name: z.string() }),
  execute: async ({ access_group_id_or_name }) => {
    const result = await vercel().accessGroups.readAccessGroup({
      ...TEAM,
      idOrName: access_group_id_or_name,
    });
    return JSON.stringify(result);
  },
});
