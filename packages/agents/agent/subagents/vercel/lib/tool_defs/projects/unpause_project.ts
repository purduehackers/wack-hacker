import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const unpause_project = defineTool({
  description: "Unpause a previously paused project. Restores the active production deployment.",
  access: { risk: "destructive" },
  input: z.strictObject({ project_id: z.string() }),
  execute: async ({ project_id }) => {
    await vercel().projects.unpauseProject({ ...TEAM, projectId: project_id });
    return JSON.stringify({ ok: true, id: project_id, paused: false });
  },
});
