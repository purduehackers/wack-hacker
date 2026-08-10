import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_domain = defineTool({
  description: "Retrieve a domain by name.",
  access: { risk: "read" },
  input: z.strictObject({ domain: z.hostname() }),
  execute: async ({ domain }) => {
    const result = await vercel().domains.getDomain({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});
