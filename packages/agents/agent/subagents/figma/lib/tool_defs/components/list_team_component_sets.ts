import type { GetTeamComponentSetsResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { summarizeComponent } from "../../projections.ts";

export const list_team_component_sets = defineTool({
  description:
    "List published component sets (variant groups) across the team. A component set groups variants of the same component.",
  access: { risk: "read" },
  input: z.strictObject({
    page_size: z.int().min(1).max(100).optional().describe("Results per page (max 100)"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ page_size, cursor }) => {
    const params = new URLSearchParams();
    if (page_size) params.set("page_size", String(page_size));
    if (cursor) params.set("after", cursor);
    const qs = params.toString();

    const data = await figma.get<GetTeamComponentSetsResponse>(
      `/v1/teams/${figma.teamId}/component_sets${qs ? `?${qs}` : ""}`,
    );
    return {
      componentSets: data.meta.component_sets.map(summarizeComponent),
      cursor: data.meta.cursor,
    };
  },
});
