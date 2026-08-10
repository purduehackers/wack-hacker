import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_project_route_versions = defineTool({
  description: "List historical versions of a project's routing rules.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id: z.string(),
  }),
  execute: async ({ project_id }) => {
    const result = await vercel().projectRoutes.getRouteVersions({
      ...TEAM,
      projectId: project_id,
    });
    return JSON.stringify(result);
  },
});
