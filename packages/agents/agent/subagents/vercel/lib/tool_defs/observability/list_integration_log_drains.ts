import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_integration_log_drains = defineTool({
  description: "List integration-backed log drains (created by installed integrations).",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await vercel().logDrains.getIntegrationLogDrains({ ...TEAM });
    return JSON.stringify(result);
  },
});
