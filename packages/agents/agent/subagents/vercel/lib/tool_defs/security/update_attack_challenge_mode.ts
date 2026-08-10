import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, TEAM } from "../../constants.ts";

export const update_attack_challenge_mode = defineTool({
  description:
    "Enable or disable attack challenge mode (shows a managed challenge page to suspected bots).",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id: z.string(),
    attackModeEnabled: z.boolean(),
    attackModeActiveUntil: epochMillis
      .optional()
      .describe("Unix ms timestamp the challenge expires at"),
  }),
  execute: async ({ project_id, attackModeEnabled, attackModeActiveUntil }) => {
    const result = await vercel().security.updateAttackChallengeMode({
      ...TEAM,
      requestBody:
        attackModeActiveUntil !== undefined
          ? { projectId: project_id, attackModeEnabled, attackModeActiveUntil }
          : { projectId: project_id, attackModeEnabled },
    });
    return JSON.stringify(result);
  },
});
