import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";
import { initiativeUpdateHealth } from "../../constants.ts";

export const update_initiative_update = defineTool({
  description: "Edit an existing initiative update's body or health status.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string(),
    body: z.string().exactOptional(),
    health: initiativeUpdateHealth,
    isDiffHidden: z.boolean().exactOptional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateInitiativeUpdate(id, input);
    const update = await payload.initiativeUpdate;
    if (!update) return "Failed to update initiative update";
    return JSON.stringify({ id: update.id, url: update.url });
  },
});
