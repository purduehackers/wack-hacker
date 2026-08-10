import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_rolling_release_config = defineTool({
  description: "Delete the rolling release configuration.",
  access: { risk: "destructive" },
  input: z.strictObject({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().rollingRelease.deleteRollingReleaseConfig({
      ...TEAM,
      idOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});
