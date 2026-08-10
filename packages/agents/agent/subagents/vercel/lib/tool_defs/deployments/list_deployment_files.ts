import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_deployment_files = defineTool({
  description: "List the file tree of a deployment's source code.",
  access: { risk: "read" },
  input: z.strictObject({ deployment_id: z.string() }),
  execute: async ({ deployment_id }) => {
    const result = await vercel().deployments.listDeploymentFiles({ ...TEAM, id: deployment_id });
    return JSON.stringify(result);
  },
});
