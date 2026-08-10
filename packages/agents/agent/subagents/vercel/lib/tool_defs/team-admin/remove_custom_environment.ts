import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const remove_custom_environment = defineTool({
  description: "Remove a custom preview environment from a project.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    environment_id_or_slug: z.string(),
    deleteUnassignedEnvironmentVariables: z.boolean().optional(),
  }),
  execute: async ({
    project_id_or_name,
    environment_id_or_slug,
    deleteUnassignedEnvironmentVariables,
  }) => {
    const result = await vercel().environment.removeCustomEnvironment({
      ...TEAM,
      idOrName: project_id_or_name,
      environmentSlugOrId: environment_id_or_slug,
      requestBody: { deleteUnassignedEnvironmentVariables },
    });
    return JSON.stringify(result);
  },
});
