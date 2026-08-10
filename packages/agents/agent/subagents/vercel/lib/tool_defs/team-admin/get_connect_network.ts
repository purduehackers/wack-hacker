import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_connect_network = defineTool({
  description: "Retrieve a Vercel Connect network by id.",
  access: { risk: "read" },
  input: z.strictObject({ network_id: z.string() }),
  execute: async ({ network_id }) => {
    const result = await vercel().connect.readNetwork({
      ...TEAM,
      networkId: network_id,
    });
    return JSON.stringify(result);
  },
});
