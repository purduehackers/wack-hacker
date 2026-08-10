import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, TEAM } from "../../constants.ts";

export const get_active_attack_status = defineTool({
  description: "Check whether Vercel detects an active attack on a project.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id: z.string(),
    since: epochMillis.optional(),
  }),
  execute: async ({ project_id, since }) => {
    const result = await vercel().security.getActiveAttackStatus({
      ...TEAM,
      projectId: project_id,
      since,
    });
    return JSON.stringify(result);
  },
});
