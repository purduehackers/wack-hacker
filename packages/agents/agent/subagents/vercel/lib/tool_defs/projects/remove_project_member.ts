import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const remove_project_member = defineTool({
  description: "Remove a member from a project.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    uid: z.string(),
  }),
  execute: async ({ project_id_or_name, uid }) => {
    const result = await vercel().projectMembers.removeProjectMember({
      ...TEAM,
      idOrName: project_id_or_name,
      uid,
    });
    return JSON.stringify(result);
  },
});
