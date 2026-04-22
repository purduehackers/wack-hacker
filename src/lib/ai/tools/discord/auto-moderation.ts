import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { DISCORD_GUILD_ID } from "../../../protocol/constants.ts";
import { approval } from "../../approvals/index.ts";
import { discord } from "./client.ts";

interface AutoModRule {
  id: string;
  name: string;
  event_type: number;
  trigger_type: number;
  enabled: boolean;
  trigger_metadata?: Record<string, unknown>;
  actions: Array<{ type: number; metadata?: Record<string, unknown> }>;
  exempt_roles?: string[];
  exempt_channels?: string[];
}

function summarize(rule: AutoModRule) {
  return {
    id: rule.id,
    name: rule.name,
    eventType: rule.event_type,
    triggerType: rule.trigger_type,
    enabled: rule.enabled,
    triggerMetadata: rule.trigger_metadata,
    actions: rule.actions,
    exemptRoles: rule.exempt_roles ?? [],
    exemptChannels: rule.exempt_channels ?? [],
  };
}

export const list_auto_mod_rules = tool({
  description:
    "List all auto-moderation rules in the Discord server. Returns rule ID, name, trigger type (keyword, spam, mention, etc.), actions, and enabled status.",
  inputSchema: z.object({}),
  execute: async () => {
    const rules = (await discord.get(
      Routes.guildAutoModerationRules(DISCORD_GUILD_ID),
    )) as AutoModRule[];
    return JSON.stringify(rules.map(summarize));
  },
});

export const get_auto_mod_rule = tool({
  description: "Get full details for a single auto-moderation rule by ID.",
  inputSchema: z.object({
    rule_id: z.string().describe("Auto-moderation rule ID"),
  }),
  execute: async ({ rule_id }) => {
    const rule = (await discord.get(
      Routes.guildAutoModerationRule(DISCORD_GUILD_ID, rule_id),
    )) as AutoModRule;
    return JSON.stringify(summarize(rule));
  },
});

export const create_auto_mod_rule = tool({
  description:
    "Create an auto-moderation rule. trigger_type: 1=keyword, 3=spam, 4=keyword_preset, 5=mention_spam, 6=member_profile. event_type is 1=message_send or 2=member_update.",
  inputSchema: z.object({
    name: z.string().describe("Rule name"),
    event_type: z.number().describe("Event type: 1=message_send, 2=member_update"),
    trigger_type: z
      .number()
      .describe("1=keyword, 3=spam, 4=keyword_preset, 5=mention_spam, 6=member_profile"),
    trigger_metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Trigger metadata (keywords, regex patterns, etc.)"),
    actions: z
      .array(
        z.object({
          type: z.number().describe("1=block_message, 2=send_alert, 3=timeout, 4=block_member"),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .describe("Actions to take when the rule triggers"),
    enabled: z.boolean().optional(),
    exempt_roles: z.array(z.string()).optional(),
    exempt_channels: z.array(z.string()).optional(),
  }),
  execute: async (input) => {
    const rule = (await discord.post(Routes.guildAutoModerationRules(DISCORD_GUILD_ID), {
      body: input,
    })) as AutoModRule;
    return JSON.stringify(summarize(rule));
  },
});

export const update_auto_mod_rule = tool({
  description: "Update an auto-moderation rule's name, trigger, actions, or enabled status.",
  inputSchema: z.object({
    rule_id: z.string().describe("Auto-moderation rule ID"),
    name: z.string().optional(),
    event_type: z.number().optional(),
    trigger_metadata: z.record(z.string(), z.unknown()).optional(),
    actions: z
      .array(
        z.object({
          type: z.number(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .optional(),
    enabled: z.boolean().optional(),
    exempt_roles: z.array(z.string()).optional(),
    exempt_channels: z.array(z.string()).optional(),
  }),
  execute: async ({ rule_id, ...body }) => {
    const rule = (await discord.patch(Routes.guildAutoModerationRule(DISCORD_GUILD_ID, rule_id), {
      body,
    })) as AutoModRule;
    return JSON.stringify(summarize(rule));
  },
});

export const delete_auto_mod_rule = approval(
  tool({
    description: "Delete an auto-moderation rule. Cannot be undone.",
    inputSchema: z.object({
      rule_id: z.string().describe("Auto-moderation rule ID"),
    }),
    execute: async ({ rule_id }) => {
      await discord.delete(Routes.guildAutoModerationRule(DISCORD_GUILD_ID, rule_id));
      return JSON.stringify({ deleted: true, rule_id });
    },
  }),
);
