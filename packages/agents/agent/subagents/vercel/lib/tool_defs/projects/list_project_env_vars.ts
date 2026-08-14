import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";
import { redactEnvValues } from "../../redaction.ts";

export const list_project_env_vars = defineTool({
  description:
    "List environment variables for a project. **Always strips the `value` field** — returns keys, targets, types only. Use `get_project_env_var` to fetch a specific decrypted value.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    gitBranch: z.string().optional(),
  }),
  execute: async ({ project_id_or_name, gitBranch }) => {
    const result = await vercel().projects.filterProjectEnvs({
      ...TEAM,
      idOrName: project_id_or_name,
      gitBranch,
    });
    return JSON.stringify(redactEnvValues(result));
  },
});
