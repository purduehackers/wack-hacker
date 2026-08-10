import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_connect_network = defineTool({
  description: "Delete a Vercel Connect private network.",
  access: { risk: "destructive" },
  input: z.strictObject({ network_id: z.string() }),
  execute: async ({ network_id }) => {
    await vercel().connect.deleteNetwork({ ...TEAM, networkId: network_id });
    return JSON.stringify({ ok: true, id: network_id });
  },
});
