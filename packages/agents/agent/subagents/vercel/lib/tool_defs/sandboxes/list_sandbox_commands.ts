import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_sandbox_commands = defineTool({
  description: "List commands that have been run inside a sandbox.",
  access: { risk: "read" },
  input: z.strictObject({
    sandbox_id: z.string(),
  }),
  execute: async ({ sandbox_id }) => {
    const result = await vercel().sandboxes.listCommands({
      ...TEAM,
      sandboxId: sandbox_id,
    });
    return JSON.stringify(result);
  },
});
