import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_sandbox = defineTool({
  description: "Retrieve a Vercel Sandbox by id.",
  access: { risk: "read" },
  input: z.strictObject({ sandbox_id: z.string() }),
  execute: async ({ sandbox_id }) => {
    const result = await vercel().sandboxes.getSandbox({ ...TEAM, sandboxId: sandbox_id });
    return JSON.stringify(result);
  },
});
