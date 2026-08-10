import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_webhooks = defineTool({
  description: "List team webhooks.",
  access: { risk: "read" },
  input: z.strictObject({
    projectId: z.string().optional(),
  }),
  execute: async ({ projectId }) => {
    const result = await vercel().webhooks.getWebhooks({ ...TEAM, projectId });
    return JSON.stringify(result);
  },
});
