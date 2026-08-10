import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const create_project_transfer_request = defineTool({
  description:
    "Create a project transfer request. Returns a `code` that another team can redeem within 24h to complete the transfer.",
  access: { risk: "destructive" },
  input: z.strictObject({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().projects.createProjectTransferRequest({
      ...TEAM,
      idOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});
