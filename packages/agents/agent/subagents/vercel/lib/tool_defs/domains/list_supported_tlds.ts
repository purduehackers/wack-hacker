import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_supported_tlds = defineTool({
  description: "List top-level domains supported by the Vercel registrar.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await vercel().domainsRegistrar.getSupportedTlds({ ...TEAM });
    return JSON.stringify(result);
  },
});
