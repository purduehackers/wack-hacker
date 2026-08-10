import type { GetTeamComponentsResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { summarizeComponent } from "../../constants.ts";

export const list_team_components = defineTool({
  description: "List published components across the team. Paginated.",
  access: { risk: "read" },
  input: z.strictObject({
    page_size: z.int().min(1).max(100).optional().describe("Results per page (max 100)"),
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
  }),
  execute: async ({ page_size, cursor }) => {
    const params = new URLSearchParams();
    if (page_size) params.set("page_size", String(page_size));
    if (cursor) params.set("after", cursor);
    const qs = params.toString();

    const data = await figma.get<GetTeamComponentsResponse>(
      `/v1/teams/${figma.teamId}/components${qs ? `?${qs}` : ""}`,
    );
    return {
      components: data.meta.components.map(summarizeComponent),
      cursor: data.meta.cursor,
    };
  },
});
