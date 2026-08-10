import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_webhook = defineTool({
  description: "Retrieve a team webhook by id.",
  access: { risk: "read" },
  input: z.strictObject({ webhook_id: z.string() }),
  execute: async ({ webhook_id }) => {
    const result = await vercel().webhooks.getWebhook({ ...TEAM, id: webhook_id });
    return JSON.stringify(result);
  },
});
