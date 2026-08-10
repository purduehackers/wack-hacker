import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_firewall_config = defineTool({
  description:
    "Retrieve a firewall configuration version for a project. Pass `configVersion: 'active'` for the live version.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id: z.string(),
    configVersion: z.string().describe("Config version id, or 'active'"),
  }),
  execute: async ({ project_id, configVersion }) => {
    const result = await vercel().security.getFirewallConfig({
      ...TEAM,
      projectId: project_id,
      configVersion,
    });
    return JSON.stringify(result);
  },
});
