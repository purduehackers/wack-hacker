import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_flag_segments = defineTool({
  description: "List targeting segments for feature flags on a project.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
  }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().featureFlags.listFlagSegments({
      ...TEAM,
      projectIdOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});
