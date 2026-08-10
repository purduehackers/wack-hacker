import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTGetAPIAutoModerationRuleResult } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { discordSnowflakeSchema, summarizeAutoModRule } from "../../constants.ts";

export const get_auto_mod_rule = defineTool({
  access: { risk: "read" },
  description: "Get full details for a single auto-moderation rule by ID.",
  input: z.strictObject({ rule_id: discordSnowflakeSchema }),
  execute: async (input) => {
    const rest = discordRest();
    return summarizeAutoModRule(
      discordObject<RESTGetAPIAutoModerationRuleResult>(
        await rest.get(Routes.guildAutoModerationRule(DISCORD_GUILD_ID, input.rule_id)),
        "get auto moderation rule",
      ),
    );
  },
});
