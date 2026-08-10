import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const get_zone = defineTool({
  description: "Retrieve one zone's details by id, including status and nameservers.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) => JSON.stringify(await cloudflare().zones.get({ zone_id })),
});
