import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_rolling_release_config = defineTool({
  description: "Get the rolling release configuration (stages, thresholds) for a project.",
  access: { risk: "read" },
  input: z.strictObject({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().rollingRelease.getRollingReleaseConfig({
      ...TEAM,
      idOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});
