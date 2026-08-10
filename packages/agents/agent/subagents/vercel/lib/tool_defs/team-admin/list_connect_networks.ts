import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_connect_networks = defineTool({
  description: "List Vercel Connect private networks on the team.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await vercel().connect.listNetworks({ ...TEAM });
    return JSON.stringify(result);
  },
});
