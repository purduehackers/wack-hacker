import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_deployment = defineTool({
  description:
    "Permanently delete a deployment by id or URL. Irreversible. Cannot be used on the active production deployment.",
  access: { risk: "destructive" },
  input: z.strictObject({
    id_or_url: z.string(),
    url: z.string().optional(),
  }),
  execute: async ({ id_or_url, url }) => {
    const result = await vercel().deployments.deleteDeployment({
      ...TEAM,
      id: id_or_url,
      url,
    });
    return JSON.stringify(result);
  },
});
