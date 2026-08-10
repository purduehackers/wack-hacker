import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_drains = defineTool({
  description:
    "List every data drain (the newer generic drain API — supports logs, traces, metrics).",
  access: { risk: "read" },
  input: z.strictObject({
    projectId: z.string().optional(),
    environments: z.array(z.string()).optional(),
  }),
  execute: async (input) => {
    const result = await vercel().drains.getDrains({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});
