import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  Routes,
  type RESTGetAPIAutoModerationRuleResult,
  type RESTPatchAPIAutoModerationRuleJSONBody,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import {
  autoModAction,
  autoModActionSchema,
  autoModMetadata,
  autoModMetadataSchema,
  AUTO_MOD_EVENT_TYPES,
  discordSnowflakeSchema,
  summarizeAutoModRule,
} from "../../constants.ts";

export const update_auto_mod_rule = defineTool({
  access: { risk: "destructive" },
  description: "Update an auto-moderation rule's name, trigger, actions, or enabled status.",
  input: z.strictObject({
    rule_id: discordSnowflakeSchema,
    name: z.string().trim().min(1).max(100).optional(),
    event_type: z.literal([1, 2]).optional(),
    trigger_metadata: autoModMetadataSchema.optional(),
    actions: z.array(autoModActionSchema).min(1).max(3).optional(),
    enabled: z.boolean().optional(),
    exempt_roles: z.array(discordSnowflakeSchema).max(20).optional(),
    exempt_channels: z.array(discordSnowflakeSchema).max(50).optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    return summarizeAutoModRule(
      discordObject<RESTGetAPIAutoModerationRuleResult>(
        await rest.patch(Routes.guildAutoModerationRule(DISCORD_GUILD_ID, input.rule_id), {
          body: compact<RESTPatchAPIAutoModerationRuleJSONBody>({
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.event_type === undefined
              ? {}
              : { event_type: AUTO_MOD_EVENT_TYPES[input.event_type] }),
            ...(input.trigger_metadata === undefined
              ? {}
              : { trigger_metadata: autoModMetadata(input.trigger_metadata) }),
            ...(input.actions === undefined ? {} : { actions: input.actions.map(autoModAction) }),
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            ...(input.exempt_roles === undefined ? {} : { exempt_roles: input.exempt_roles }),
            ...(input.exempt_channels === undefined
              ? {}
              : { exempt_channels: input.exempt_channels }),
          }),
        }),
        "update auto moderation rule",
      ),
    );
  },
});
