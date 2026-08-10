import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_access_group = defineTool({
  description: "Delete an access group.",
  access: { risk: "destructive" },
  input: z.strictObject({ access_group_id_or_name: z.string() }),
  execute: async ({ access_group_id_or_name }) => {
    await vercel().accessGroups.deleteAccessGroup({
      ...TEAM,
      idOrName: access_group_id_or_name,
    });
    return JSON.stringify({ ok: true, id: access_group_id_or_name });
  },
});
