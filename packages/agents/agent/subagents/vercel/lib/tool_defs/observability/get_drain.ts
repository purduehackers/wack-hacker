import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_drain = defineTool({
  description: "Retrieve a drain by id.",
  access: { risk: "read" },
  input: z.strictObject({ drain_id: z.string() }),
  execute: async ({ drain_id }) => {
    const result = await vercel().drains.getDrain({ ...TEAM, id: drain_id });
    return JSON.stringify(result);
  },
});
