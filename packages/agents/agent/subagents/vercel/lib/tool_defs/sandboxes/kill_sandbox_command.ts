import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const kill_sandbox_command = defineTool({
  description: "Terminate a running sandbox command.",
  access: { risk: "destructive" },
  input: z.strictObject({
    sandbox_id: z.string(),
    command_id: z.string(),
  }),
  execute: async ({ sandbox_id, command_id }) => {
    const result = await vercel().sandboxes.killCommand({
      ...TEAM,
      sandboxId: sandbox_id,
      cmdId: command_id,
    });
    return JSON.stringify(result);
  },
});
