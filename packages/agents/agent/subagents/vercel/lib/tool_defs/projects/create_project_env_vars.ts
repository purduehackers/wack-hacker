import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { ENV_TARGETS, ENV_TYPES, redactEnvValues, TEAM } from "../../constants.ts";

export const create_project_env_vars = defineTool({
  description:
    "Create one or more environment variables on a project. Pass `upsert: true` to update-if-exists.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    upsert: z.boolean().optional(),
    entries: z
      .array(
        z.strictObject({
          key: z.string(),
          value: z.string(),
          type: z.enum(ENV_TYPES),
          target: z.array(z.enum(ENV_TARGETS)),
          gitBranch: z.string().optional(),
          comment: z.string().optional(),
        }),
      )
      .min(1),
  }),
  execute: async ({ project_id_or_name, upsert, entries }) => {
    const result = await vercel().projects.createProjectEnv({
      ...TEAM,
      idOrName: project_id_or_name,
      upsert: upsert ? "true" : undefined,
      requestBody: entries,
    });
    return JSON.stringify(redactEnvValues(result));
  },
});
