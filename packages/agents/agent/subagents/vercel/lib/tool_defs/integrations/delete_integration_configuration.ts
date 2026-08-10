import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_integration_configuration = defineTool({
  description: "Uninstall an integration.",
  access: { risk: "destructive" },
  input: z.strictObject({ configuration_id: z.string() }),
  execute: async ({ configuration_id }) => {
    await vercel().integrations.deleteConfiguration({ ...TEAM, id: configuration_id });
    return JSON.stringify({ ok: true, id: configuration_id });
  },
});
