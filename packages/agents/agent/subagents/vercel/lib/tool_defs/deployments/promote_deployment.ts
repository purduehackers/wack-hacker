import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

// Promote and rollback live on the SDK's `projects` accessor, but they
// semantically operate on a deployment, so they belong to this skill.
export const promote_deployment = defineTool({
  description:
    "Promote a deployment to production without rebuilding it. Returns immediately; the actual traffic shift is async — check `list_promote_aliases` for status.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id: z.string(),
    deployment_id: z.string(),
  }),
  execute: async ({ project_id, deployment_id }) => {
    await vercel().projects.requestPromote({
      ...TEAM,
      projectId: project_id,
      deploymentId: deployment_id,
    });
    return JSON.stringify({
      ok: true,
      projectId: project_id,
      deploymentId: deployment_id,
      note: "Promote request accepted. Poll list_promote_aliases for traffic status.",
    });
  },
});
