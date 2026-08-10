import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTGetAPIAutoModerationRulesResult } from "discord-api-types/v10";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordArray, discordRest } from "../../client.ts";
import { empty, summarizeAutoModRule } from "../../constants.ts";

export const list_auto_mod_rules = defineTool({
  access: { risk: "read" },
  description:
    "List all auto-moderation rules in the Discord server. Returns rule ID, name, trigger type (keyword, spam, mention, etc.), actions, and enabled status.",
  input: empty,
  execute: async () => {
    const rest = discordRest();
    return discordArray<RESTGetAPIAutoModerationRulesResult>(
      await rest.get(Routes.guildAutoModerationRules(DISCORD_GUILD_ID)),
      "list auto moderation rules",
    ).map(summarizeAutoModRule);
  },
});
