import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_integration_log_drain = defineTool({
  description: "Delete an integration log drain.",
  access: { risk: "destructive" },
  input: z.strictObject({ drain_id: z.string() }),
  execute: async ({ drain_id }) => {
    await vercel().logDrains.deleteIntegrationLogDrain({ ...TEAM, id: drain_id });
    return JSON.stringify({ ok: true, id: drain_id });
  },
});
