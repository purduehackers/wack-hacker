import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const stop_sandbox = defineTool({
  description: "Stop a running Vercel Sandbox. Files and state within the sandbox are lost.",
  access: { risk: "destructive" },
  input: z.strictObject({ sandbox_id: z.string() }),
  execute: async ({ sandbox_id }) => {
    const result = await vercel().sandboxes.stopSandbox({
      ...TEAM,
      sandboxId: sandbox_id,
    });
    return JSON.stringify(result);
  },
});
