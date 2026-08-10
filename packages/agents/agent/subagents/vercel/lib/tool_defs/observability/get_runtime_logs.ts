import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_runtime_logs = defineTool({
  description:
    "Fetch runtime logs for a specific deployment. Returns platform/runtime logs (cold starts, function invocation, timeouts). For application errors, prefer the Sentry subagent.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id: z.string(),
    deployment_id: z.string(),
  }),
  execute: async ({ project_id, deployment_id }) => {
    const result = await vercel().logs.getRuntimeLogs({
      ...TEAM,
      projectId: project_id,
      deploymentId: deployment_id,
    });
    return JSON.stringify(result);
  },
});
