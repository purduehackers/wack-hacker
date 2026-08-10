import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_sandbox_command = defineTool({
  description: "Retrieve a command by id.",
  access: { risk: "read" },
  input: z.strictObject({
    sandbox_id: z.string(),
    command_id: z.string(),
  }),
  execute: async ({ sandbox_id, command_id }) => {
    const result = await vercel().sandboxes.getCommand({
      ...TEAM,
      sandboxId: sandbox_id,
      cmdId: command_id,
    });
    return JSON.stringify(result);
  },
});
