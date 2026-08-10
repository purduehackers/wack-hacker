import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";
import { projectUpdateHealth } from "../../constants.ts";

export const create_project_update = defineTool({
  description:
    "Create a project status update with Markdown body and health (onTrack/atRisk/offTrack). Draft in chat first unless the user says to post immediately.",
  access: { risk: "write" },
  input: z.strictObject({
    projectId: z.string(),
    body: z.string().exactOptional().describe("Markdown"),
    health: projectUpdateHealth,
    isDiffHidden: z.boolean().exactOptional(),
  }),
  execute: async (input) => {
    const payload = await linear.createProjectUpdate(input);
    const update = await payload.projectUpdate;
    if (!update) return "Failed to create project update";
    return JSON.stringify({ id: update.id, url: update.url });
  },
});
