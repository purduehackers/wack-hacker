import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { redactEnvValues, TEAM } from "../../constants.ts";

export const remove_project_env_var = defineTool({
  description: "Remove a single environment variable from a project by its id.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    env_var_id: z.string(),
  }),
  execute: async ({ project_id_or_name, env_var_id }) => {
    const result = await vercel().projects.removeProjectEnv({
      ...TEAM,
      idOrName: project_id_or_name,
      id: env_var_id,
    });
    return JSON.stringify(redactEnvValues(result));
  },
});
