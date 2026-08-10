import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_flag = defineTool({
  description: "Permanently delete a feature flag.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    flag_id: z.string(),
  }),
  execute: async ({ project_id_or_name, flag_id }) => {
    await vercel().featureFlags.deleteFlag({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      flagIdOrSlug: flag_id,
    });
    return JSON.stringify({ ok: true, id: flag_id });
  },
});
