import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_deployment_aliases = defineTool({
  description: "List every alias currently pointing at a specific deployment id.",
  access: { risk: "read" },
  input: z.strictObject({ deployment_id: z.string() }),
  execute: async ({ deployment_id }) => {
    const result = await vercel().aliases.listDeploymentAliases({ ...TEAM, id: deployment_id });
    return JSON.stringify(result);
  },
});
