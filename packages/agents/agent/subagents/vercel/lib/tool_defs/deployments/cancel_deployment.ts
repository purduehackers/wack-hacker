import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const cancel_deployment = defineTool({
  description:
    "Cancel an in-flight deployment (state must be BUILDING / QUEUED / INITIALIZING). Returns the deployment's new state.",
  access: { risk: "destructive" },
  input: z.strictObject({ deployment_id: z.string() }),
  execute: async ({ deployment_id }) => {
    const result = await vercel().deployments.cancelDeployment({ ...TEAM, id: deployment_id });
    return JSON.stringify(result);
  },
});
