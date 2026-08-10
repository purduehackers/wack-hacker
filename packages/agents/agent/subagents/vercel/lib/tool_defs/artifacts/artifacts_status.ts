import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const artifacts_status = defineTool({
  description: "Get the Turborepo remote cache status for the team (enabled? usage?).",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await vercel().artifacts.status({ ...TEAM });
    return JSON.stringify(result);
  },
});
