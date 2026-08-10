import type { GetTeamProjectsResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";

export const list_projects = defineTool({
  description: "List all projects in the team. Returns project IDs and names.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const data = await figma.get<GetTeamProjectsResponse>(`/v1/teams/${figma.teamId}/projects`);
    return data.projects.map((p) => ({
      id: p.id,
      name: p.name,
    }));
  },
});
