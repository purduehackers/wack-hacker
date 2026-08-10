import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_deployment_file_contents = defineTool({
  description: "Get the contents of a specific file from a deployment. Response is base64-encoded.",
  access: { risk: "read" },
  input: z.strictObject({
    deployment_id: z.string(),
    file_id: z.string(),
    path: z.string().optional(),
  }),
  execute: async ({ deployment_id, file_id, path }) => {
    const result = await vercel().deployments.getDeploymentFileContents({
      ...TEAM,
      id: deployment_id,
      fileId: file_id,
      path,
    });
    return JSON.stringify(result);
  },
});
