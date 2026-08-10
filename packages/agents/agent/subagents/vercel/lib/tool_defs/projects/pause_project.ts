import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const pause_project = defineTool({
  description: "Pause a project. Blocks the active production deployment until unpaused.",
  access: { risk: "destructive" },
  input: z.strictObject({ project_id: z.string() }),
  execute: async ({ project_id }) => {
    await vercel().projects.pauseProject({ ...TEAM, projectId: project_id });
    return JSON.stringify({ ok: true, id: project_id, paused: true });
  },
});
