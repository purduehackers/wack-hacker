import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const rollback_deployment = defineTool({
  description:
    "Roll production traffic back to an older deployment. Async — check `list_promote_aliases` for completion.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id: z.string(),
    deployment_id: z.string(),
  }),
  execute: async ({ project_id, deployment_id }) => {
    await vercel().projects.requestRollback({
      ...TEAM,
      projectId: project_id,
      deploymentId: deployment_id,
    });
    return JSON.stringify({
      ok: true,
      projectId: project_id,
      deploymentId: deployment_id,
      note: "Rollback request accepted. Poll list_promote_aliases for traffic status.",
    });
  },
});
