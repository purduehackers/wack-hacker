import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const check_domain_availability = defineTool({
  description: "Check whether a domain is available to register.",
  access: { risk: "read" },
  input: z.strictObject({ domain: z.hostname() }),
  execute: async ({ domain }) => {
    const result = await vercel().domainsRegistrar.getDomainAvailability({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});
