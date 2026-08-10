import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { numericString, TEAM } from "../../constants.ts";

export const get_domain_price = defineTool({
  description: "Get the price to register a specific domain for N years.",
  access: { risk: "read" },
  input: z.strictObject({
    domain: z.hostname(),
    years: numericString.optional(),
  }),
  execute: async ({ domain, years }) => {
    const result = await vercel().domainsRegistrar.getDomainPrice({ ...TEAM, domain, years });
    return JSON.stringify(result);
  },
});
