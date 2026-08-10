import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_drain = defineTool({
  description: "Delete a data drain.",
  access: { risk: "destructive" },
  input: z.strictObject({ drain_id: z.string() }),
  execute: async ({ drain_id }) => {
    await vercel().drains.deleteDrain({ ...TEAM, id: drain_id });
    return JSON.stringify({ ok: true, id: drain_id });
  },
});
