import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_integration_configurations = defineTool({
  description:
    "List every integration installed on the team (marketplace apps — Turso, Upstash, Neon, etc.). `view` is required.",
  access: { risk: "read" },
  input: z.strictObject({
    view: z.enum(["account", "project"]),
    integrationIdOrSlug: z.string().optional(),
    installationType: z.enum(["marketplace", "external"]).optional(),
  }),
  execute: async (input) => {
    const result = await vercel().integrations.getConfigurations({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});
