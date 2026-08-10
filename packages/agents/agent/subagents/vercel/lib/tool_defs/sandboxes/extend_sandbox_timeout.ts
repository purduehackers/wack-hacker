import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const extend_sandbox_timeout = defineTool({
  description:
    "Extend a sandbox's maximum runtime by an additional `duration` (seconds). Costs additional compute.",
  access: { risk: "write", confirm: "self" },
  input: z.strictObject({
    sandbox_id: z.string(),
    duration: z.int().positive().describe("Additional runtime in seconds"),
  }),
  execute: async ({ sandbox_id, duration }) => {
    const result = await vercel().sandboxes.extendSandboxTimeout({
      ...TEAM,
      sandboxId: sandbox_id,
      requestBody: { duration },
    });
    return JSON.stringify(result);
  },
});
