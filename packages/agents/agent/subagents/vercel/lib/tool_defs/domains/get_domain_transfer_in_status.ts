import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_domain_transfer_in_status = defineTool({
  description: "Get status of a pending inbound domain transfer.",
  access: { risk: "read" },
  input: z.strictObject({ domain: z.hostname() }),
  execute: async ({ domain }) => {
    const result = await vercel().domainsRegistrar.getDomainTransferIn({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});
