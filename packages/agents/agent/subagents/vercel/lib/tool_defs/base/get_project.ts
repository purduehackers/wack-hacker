import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_project = defineTool({
  description: "Retrieve a single Vercel project by id or name (via search).",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string().describe("Vercel project id (prj_…) or name"),
  }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().projects.getProjects({
      ...TEAM,
      search: project_id_or_name,
      limit: "1",
    });
    return JSON.stringify(result);
  },
});
