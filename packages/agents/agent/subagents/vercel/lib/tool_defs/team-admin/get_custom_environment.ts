import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_custom_environment = defineTool({
  description: "Get a specific custom environment by id or slug.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    environment_id_or_slug: z.string(),
  }),
  execute: async ({ project_id_or_name, environment_id_or_slug }) => {
    const result = await vercel().environment.getCustomEnvironment({
      ...TEAM,
      idOrName: project_id_or_name,
      environmentSlugOrId: environment_id_or_slug,
    });
    return JSON.stringify(result);
  },
});
