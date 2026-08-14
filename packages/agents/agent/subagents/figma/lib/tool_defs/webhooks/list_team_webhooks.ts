import type { GetTeamWebhooksResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { summarizeWebhook } from "../../projections.ts";

export const list_team_webhooks = defineTool({
  description: "List all webhooks configured for the team.",
  access: { risk: "read", minRole: "admin" },
  input: z.strictObject({}),
  execute: async () => {
    const data = await figma.get<GetTeamWebhooksResponse>(`/v2/teams/${figma.teamId}/webhooks`);
    return data.webhooks.map(summarizeWebhook);
  },
});
