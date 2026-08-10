import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_sandbox_command_logs = defineTool({
  description: "Fetch stdout/stderr of a sandbox command.",
  access: { risk: "read" },
  input: z.strictObject({
    sandbox_id: z.string(),
    command_id: z.string(),
  }),
  execute: async ({ sandbox_id, command_id }) => {
    const result = await vercel().sandboxes.getCommandLogs({
      ...TEAM,
      sandboxId: sandbox_id,
      cmdId: command_id,
    });
    return JSON.stringify(result);
  },
});
