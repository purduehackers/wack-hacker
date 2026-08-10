import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";
import { projectUpdateHealth } from "../../constants.ts";

export const update_project_update = defineTool({
  description: "Edit an existing project update's body or health status.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string(),
    body: z.string().exactOptional(),
    health: projectUpdateHealth,
    isDiffHidden: z.boolean().exactOptional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateProjectUpdate(id, input);
    const update = await payload.projectUpdate;
    if (!update) return "Failed to update project update";
    return JSON.stringify({ id: update.id, url: update.url });
  },
});
