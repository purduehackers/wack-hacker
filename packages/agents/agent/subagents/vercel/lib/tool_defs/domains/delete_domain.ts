import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_domain = defineTool({
  description:
    "Remove a domain from the team. The registration itself may persist at the registrar.",
  access: { risk: "destructive" },
  input: z.strictObject({ domain: z.hostname() }),
  execute: async ({ domain }) => {
    const result = await vercel().domains.deleteDomain({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});
