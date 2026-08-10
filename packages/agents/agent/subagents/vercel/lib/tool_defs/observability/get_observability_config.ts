import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_observability_config = defineTool({
  description: "Retrieve the API Observability configuration for the team.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await vercel().apiObservability.getObservabilityConfigurationProjects({
      ...TEAM,
    });
    return JSON.stringify(result);
  },
});
