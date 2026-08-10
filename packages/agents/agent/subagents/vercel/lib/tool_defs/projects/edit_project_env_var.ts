import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { ENV_TARGETS, ENV_TYPES, redactEnvValues, TEAM } from "../../constants.ts";

export const edit_project_env_var = defineTool({
  description: "Edit a single environment variable.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    env_var_id: z.string(),
    key: z.string().optional(),
    value: z.string().optional(),
    type: z.enum(ENV_TYPES).optional(),
    target: z.array(z.enum(ENV_TARGETS)).optional(),
    gitBranch: z.string().optional(),
    comment: z.string().optional(),
  }),
  execute: async ({ project_id_or_name, env_var_id, ...patch }) => {
    const result = await vercel().projects.editProjectEnv({
      ...TEAM,
      idOrName: project_id_or_name,
      id: env_var_id,
      requestBody: patch,
    });
    return JSON.stringify(redactEnvValues(result));
  },
});
