import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_project = defineTool({
  description:
    "Permanently delete a Vercel project and every deployment underneath it. Irreversible.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({
    project_id_or_name: z.string(),
  }),
  execute: async ({ project_id_or_name }) => {
    await vercel().projects.deleteProject({ ...TEAM, idOrName: project_id_or_name });
    return JSON.stringify({ ok: true, id: project_id_or_name });
  },
});
