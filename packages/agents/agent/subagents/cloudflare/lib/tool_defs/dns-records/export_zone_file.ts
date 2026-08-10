import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { cloudflare } from "../../client.ts";
import { zoneId } from "../../constants.ts";

export const export_zone_file = defineTool({
  description:
    "Export the whole zone as a BIND zone file. Useful as a before-picture to quote back to the user ahead of a risky change.",
  access: { risk: "read" },
  input: z.strictObject({ zone_id: zoneId }),
  execute: async ({ zone_id }) => await cloudflare().dns.records.export({ zone_id }),
});
