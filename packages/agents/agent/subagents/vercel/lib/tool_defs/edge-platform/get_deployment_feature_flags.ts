import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_deployment_feature_flags = defineTool({
  description: "Get the feature flags evaluated during a specific deployment.",
  access: { risk: "read" },
  input: z.strictObject({ deployment_id: z.string() }),
  execute: async ({ deployment_id }) => {
    const result = await vercel().featureFlags.getDeploymentFeatureFlags({
      ...TEAM,
      deploymentId: deployment_id,
    });
    return JSON.stringify(result);
  },
});
