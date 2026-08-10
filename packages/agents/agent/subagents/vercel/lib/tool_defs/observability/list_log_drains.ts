import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_log_drains = defineTool({
  description: "List every configurable log drain on the team.",
  access: { risk: "read" },
  input: z.strictObject({
    projectId: z.string().optional(),
    projectIdOrName: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().logDrains.getAllLogDrains({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});
