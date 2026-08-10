import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const update_observability_config = defineTool({
  description: "Update the API Observability Plus setting (enabled/disabled) for a project.",
  access: { risk: "write" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    disabled: z.boolean(),
  }),
  execute: async ({ project_id_or_name, disabled }) => {
    const result = await vercel().apiObservability.updateObservabilityConfigurationProject({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { disabled },
    });
    return JSON.stringify(result);
  },
});
