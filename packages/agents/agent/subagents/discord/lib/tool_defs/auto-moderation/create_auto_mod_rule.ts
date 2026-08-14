import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  AutoModerationRuleTriggerType,
  Routes,
  type RESTPostAPIAutoModerationRuleJSONBody,
  type RESTPostAPIAutoModerationRuleResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import {
  autoModActionSchema,
  autoModMetadataSchema,
  AUTO_MOD_EVENT_TYPES,
  discordSnowflakeSchema,
} from "../../constants.ts";
import { autoModAction, autoModMetadata, summarizeAutoModRule } from "../../projections.ts";

/** Only creation names a trigger. An update cannot change what a rule triggers on. */
const AUTO_MOD_TRIGGER_TYPES = {
  1: AutoModerationRuleTriggerType.Keyword,
  3: AutoModerationRuleTriggerType.Spam,
  4: AutoModerationRuleTriggerType.KeywordPreset,
  5: AutoModerationRuleTriggerType.MentionSpam,
  6: AutoModerationRuleTriggerType.MemberProfile,
} as const;

export const create_auto_mod_rule = defineTool({
  access: { risk: "destructive" },
  description:
    "Create an auto-moderation rule. trigger_type: 1=keyword, 3=spam, 4=keyword_preset, 5=mention_spam, 6=member_profile. event_type is 1=message_send or 2=member_update.",
  input: z.strictObject({
    name: z.string().trim().min(1).max(100),
    event_type: z.literal([1, 2]),
    trigger_type: z.literal([1, 3, 4, 5, 6]),
    trigger_metadata: autoModMetadataSchema.optional(),
    actions: z.array(autoModActionSchema).min(1).max(3),
    enabled: z.boolean().optional(),
    exempt_roles: z.array(discordSnowflakeSchema).max(20).optional(),
    exempt_channels: z.array(discordSnowflakeSchema).max(50).optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    return summarizeAutoModRule(
      discordObject<RESTPostAPIAutoModerationRuleResult>(
        await rest.post(Routes.guildAutoModerationRules(DISCORD_GUILD_ID), {
          body: compact<RESTPostAPIAutoModerationRuleJSONBody>({
            name: input.name,
            event_type: AUTO_MOD_EVENT_TYPES[input.event_type],
            trigger_type: AUTO_MOD_TRIGGER_TYPES[input.trigger_type],
            trigger_metadata: autoModMetadata(input.trigger_metadata),
            actions: input.actions.map(autoModAction),
            enabled: input.enabled,
            exempt_roles: input.exempt_roles,
            exempt_channels: input.exempt_channels,
          }),
        }),
        "create auto moderation rule",
      ),
    );
  },
});
