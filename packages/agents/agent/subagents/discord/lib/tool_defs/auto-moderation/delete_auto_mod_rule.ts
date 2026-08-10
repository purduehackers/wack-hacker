import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { discordSnowflakeSchema } from "../../constants.ts";

export const delete_auto_mod_rule = defineTool({
  access: { risk: "destructive" },
  description: "Delete an auto-moderation rule. Cannot be undone.",
  input: z.strictObject({ rule_id: discordSnowflakeSchema }),
  execute: async (input) => {
    const rest = discordRest();
    await rest.delete(Routes.guildAutoModerationRule(DISCORD_GUILD_ID, input.rule_id));
    return { deleted: true, rule_id: input.rule_id };
  },
});
