import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_project_env_var = defineTool({
  description:
    "Retrieve a single environment variable by its id, **including its decrypted value**. Use sparingly.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    env_var_id: z.string(),
  }),
  execute: async ({ project_id_or_name, env_var_id }) => {
    const result = await vercel().projects.getProjectEnv({
      ...TEAM,
      idOrName: project_id_or_name,
      id: env_var_id,
    });
    return JSON.stringify(result);
  },
});
