import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const create_sdk_key = defineTool({
  description: "Create a new feature-flags SDK key for a project.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    sdkKeyType: z.enum(["server", "client"]),
    environment: z.string(),
    label: z.string().optional(),
  }),
  execute: async ({ project_id_or_name, sdkKeyType, environment, label }) => {
    const result = await vercel().featureFlags.createSDKKey({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { sdkKeyType, environment, label },
    });
    return JSON.stringify(result);
  },
});
