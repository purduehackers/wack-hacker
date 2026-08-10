import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_domain_auth_code = defineTool({
  description: "Retrieve the transfer auth code for a domain registered at the Vercel registrar.",
  access: { risk: "destructive" },
  input: z.strictObject({ domain: z.hostname() }),
  execute: async ({ domain }) => {
    const result = await vercel().domainsRegistrar.getDomainAuthCode({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});
