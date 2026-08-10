import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";
import { initiativeUpdateHealth } from "../../constants.ts";

export const create_initiative_update = defineTool({
  description:
    "Create an initiative status update with Markdown body and health (onTrack/atRisk/offTrack). For cross-project reporting.",
  access: { risk: "write" },
  input: z.strictObject({
    initiativeId: z.string(),
    body: z.string().exactOptional().describe("Markdown"),
    health: initiativeUpdateHealth,
    isDiffHidden: z.boolean().exactOptional(),
  }),
  execute: async (input) => {
    const payload = await linear.createInitiativeUpdate(input);
    const update = await payload.initiativeUpdate;
    if (!update) return "Failed to create initiative update";
    return JSON.stringify({ id: update.id, url: update.url });
  },
});
