/**
 * Discord guild administration — server settings, scheduled events, invites,
 * the audit log and auto-moderation rules.
 *
 * These are ordinary provider calls against Discord's REST API, exactly like
 * Linear or Notion: the agent holds its own Discord identity rather than asking
 * the bot to administer the guild on its behalf.
 */
/* oxlint-disable unicorn/no-null -- Discord's JSON API uses null for explicit absence/field clearing. */

import { makeURLSearchParams, type REST } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { UpstreamError } from "@repo/shared/errors";
import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  Routes,
  type RESTGetAPIAuditLogQuery,
  type RESTGetAPIAuditLogResult,
  type RESTGetAPIAutoModerationRuleResult,
  type RESTGetAPIAutoModerationRulesResult,
  type RESTGetAPIGuildInvitesResult,
  type RESTGetAPIGuildPreviewResult,
  type RESTGetAPIGuildQuery,
  type RESTGetAPIGuildResult,
  type RESTGetAPIGuildScheduledEventResult,
  type RESTGetAPIGuildScheduledEventsQuery,
  type RESTGetAPIGuildScheduledEventsResult,
  type RESTGetAPIGuildVanityUrlResult,
  type RESTGetAPIInviteResult,
  type RESTPatchAPIAutoModerationRuleJSONBody,
  type RESTPatchAPIGuildJSONBody,
  type RESTPatchAPIGuildResult,
  type RESTPatchAPIGuildScheduledEventJSONBody,
  type RESTPatchAPIGuildScheduledEventResult,
  type RESTPostAPIAutoModerationRuleJSONBody,
  type RESTPostAPIAutoModerationRuleResult,
  type RESTPostAPIChannelInviteJSONBody,
  type RESTPostAPIChannelInviteResult,
  type RESTPostAPIGuildScheduledEventJSONBody,
  type RESTPostAPIGuildScheduledEventResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../lib/policy/domain-tools.ts";
import { compact, discordArray, discordObject, discordRest } from "../rest.ts";
import {
  channelId,
  discordSnowflakeSchema,
  empty,
  guildChannel,
  httpUrl,
  imageDataUri,
  reason,
  responseString,
} from "./common.ts";

const isoDateTime = z.iso.datetime({ offset: true });
const dataUri = z
  .stringFormat("image-data-uri", /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/iu)
  .max(8_000_000);

const autoModMetadataSchema = z.strictObject({
  keyword_filter: z.array(z.string().min(1).max(60)).max(1_000).optional(),
  regex_patterns: z.array(z.string().min(1).max(260)).max(10).optional(),
  presets: z
    .array(z.literal([1, 2, 3]))
    .max(3)
    .optional(),
  allow_list: z.array(z.string().min(1).max(60)).max(100).optional(),
  mention_total_limit: z.int().min(1).max(50).optional(),
  mention_raid_protection_enabled: z.boolean().optional(),
});
const autoModCustomMessage = z.string().trim().min(1).max(150);
/**
 * Discord couples an auto-mod action's metadata to its type: only an alert
 * (type 2) carries a channel, only a timeout (type 3) carries a duration. The
 * discriminated union states that directly, so the model sees three concrete
 * shapes rather than one loose object with four cross-field rules attached.
 */
const autoModActionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal([1, 4]),
    metadata: z.strictObject({ custom_message: autoModCustomMessage.optional() }).optional(),
  }),
  z.strictObject({
    type: z.literal(2),
    metadata: z.strictObject({
      channel_id: discordSnowflakeSchema,
      custom_message: autoModCustomMessage.optional(),
    }),
  }),
  z.strictObject({
    type: z.literal(3),
    metadata: z.strictObject({
      duration_seconds: z.int().min(1).max(2_419_200),
      custom_message: autoModCustomMessage.optional(),
    }),
  }),
]);

const eventCreate = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1_000).optional(),
    scheduled_start: isoDateTime,
    scheduled_end: isoDateTime.optional(),
    type: z.enum(["voice", "stage", "external"]).default("external"),
    channel_id: discordSnowflakeSchema.optional(),
    location: z.string().trim().min(1).max(100).optional(),
    image: httpUrl.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "external") {
      if (value.location === undefined)
        ctx.addIssue({
          code: "custom",
          path: ["location"],
          message: "external events require a location",
        });
      if (value.scheduled_end === undefined)
        ctx.addIssue({
          code: "custom",
          path: ["scheduled_end"],
          message: "external events require an end time",
        });
      if (value.channel_id !== undefined)
        ctx.addIssue({
          code: "custom",
          path: ["channel_id"],
          message: "external events cannot have a channel",
        });
    } else if (value.channel_id === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["channel_id"],
        message: "voice and stage events require a channel",
      });
    }
  });

const EVENT_TYPES = {
  stage: GuildScheduledEventEntityType.StageInstance,
  voice: GuildScheduledEventEntityType.Voice,
  external: GuildScheduledEventEntityType.External,
} as const;
const EVENT_STATUSES = {
  scheduled: GuildScheduledEventStatus.Scheduled,
  active: GuildScheduledEventStatus.Active,
  completed: GuildScheduledEventStatus.Completed,
  canceled: GuildScheduledEventStatus.Canceled,
} as const;
const AUTO_MOD_EVENT_TYPES = {
  1: AutoModerationRuleEventType.MessageSend,
  2: AutoModerationRuleEventType.MemberUpdate,
} as const;
const AUTO_MOD_TRIGGER_TYPES = {
  1: AutoModerationRuleTriggerType.Keyword,
  3: AutoModerationRuleTriggerType.Spam,
  4: AutoModerationRuleTriggerType.KeywordPreset,
  5: AutoModerationRuleTriggerType.MentionSpam,
  6: AutoModerationRuleTriggerType.MemberProfile,
} as const;
const AUTO_MOD_ACTION_TYPES = {
  1: AutoModerationActionType.BlockMessage,
  2: AutoModerationActionType.SendAlertMessage,
  3: AutoModerationActionType.Timeout,
  4: AutoModerationActionType.BlockMemberInteraction,
} as const;

type AutoModMetadataInput = z.output<typeof autoModMetadataSchema> | undefined;
type AutoModActionInput = z.output<typeof autoModActionSchema>;

function autoModMetadata(
  metadata: AutoModMetadataInput,
): RESTPostAPIAutoModerationRuleJSONBody["trigger_metadata"] {
  if (metadata === undefined) return undefined;
  return compact({
    ...(metadata.keyword_filter === undefined ? {} : { keyword_filter: metadata.keyword_filter }),
    ...(metadata.regex_patterns === undefined ? {} : { regex_patterns: metadata.regex_patterns }),
    ...(metadata.presets === undefined ? {} : { presets: metadata.presets }),
    ...(metadata.allow_list === undefined ? {} : { allow_list: metadata.allow_list }),
    ...(metadata.mention_total_limit === undefined
      ? {}
      : { mention_total_limit: metadata.mention_total_limit }),
    ...(metadata.mention_raid_protection_enabled === undefined
      ? {}
      : { mention_raid_protection_enabled: metadata.mention_raid_protection_enabled }),
  });
}

function autoModActionMetadata(action: AutoModActionInput) {
  const custom = action.metadata?.custom_message;
  const message = custom === undefined ? {} : { custom_message: custom };
  if (action.type === 2) return { ...message, channel_id: action.metadata.channel_id };
  if (action.type === 3) return { ...message, duration_seconds: action.metadata.duration_seconds };
  return action.metadata === undefined ? undefined : message;
}

function autoModAction(
  action: AutoModActionInput,
): RESTPostAPIAutoModerationRuleJSONBody["actions"][number] {
  const metadata = autoModActionMetadata(action);
  return compact({
    type: AUTO_MOD_ACTION_TYPES[action.type],
    ...(metadata === undefined ? {} : { metadata }),
  });
}

function summarizeAutoModRule(rule: RESTGetAPIAutoModerationRuleResult) {
  return {
    id: rule.id,
    name: rule.name,
    eventType: rule.event_type,
    triggerType: rule.trigger_type,
    enabled: rule.enabled,
    triggerMetadata: rule.trigger_metadata,
    actions: rule.actions,
    exemptRoles: rule.exempt_roles,
    exemptChannels: rule.exempt_channels,
  };
}

type ScheduledEventResult = RESTGetAPIGuildScheduledEventsResult[number];
function summarizeEvent(event: ScheduledEventResult) {
  const metadata =
    event.entity_metadata === null
      ? null
      : discordObject<NonNullable<ScheduledEventResult["entity_metadata"]>>(
          event.entity_metadata,
          "guild scheduled event metadata",
        );
  const eventId = discordSnowflakeSchema.safeParse(event.id).data;
  const eventImage = responseString.safeParse(event.image).data;
  return {
    id: event.id,
    name: event.name,
    description: event.description ?? null,
    scheduledStartAt: event.scheduled_start_time ?? null,
    scheduledEndAt: event.scheduled_end_time ?? null,
    status: event.status,
    entityType: event.entity_type,
    channelId: event.channel_id ?? null,
    location: metadata?.location ?? null,
    userCount: event.user_count ?? null,
    creatorId: event.creator_id ?? null,
    image:
      eventId === undefined || eventImage === undefined
        ? null
        : `https://cdn.discordapp.com/guild-events/${eventId}/${eventImage}.png`,
  };
}

function summarizeInvite(invite: RESTGetAPIGuildInvitesResult[number]) {
  const channel =
    invite.channel === null
      ? null
      : discordObject<NonNullable<RESTGetAPIGuildInvitesResult[number]["channel"]>>(
          invite.channel,
          "invite channel",
        );
  const creator =
    invite.inviter === undefined
      ? undefined
      : discordObject<NonNullable<RESTGetAPIGuildInvitesResult[number]["inviter"]>>(
          invite.inviter,
          "invite creator",
        );
  return {
    code: invite.code,
    channel: channel === null ? null : { id: channel.id, name: channel.name },
    inviter: creator === undefined ? null : { id: creator.id, username: creator.username },
    uses: invite.uses,
    maxUses: invite.max_uses,
    maxAge: invite.max_age,
    temporary: invite.temporary,
    expiresAt: invite.expires_at ?? null,
  };
}

async function requireGuildInvite(rest: REST, code: string): Promise<void> {
  const invite = discordObject<RESTGetAPIInviteResult>(
    await rest.get(Routes.invite(code)),
    "get invite",
  );
  if (invite.guild?.id !== DISCORD_GUILD_ID) {
    throw new UpstreamError({
      service: "Discord",
      status: 403,
      detail: "invite is outside the managed guild",
    });
  }
}

const EVENT_IMAGE_MAX_BYTES = 8 * 1_024 * 1_024;

export const GUILD_OPERATIONS = {
  get_server_info: defineTool({
    access: { risk: "read" },
    description:
      "Get Discord server overview: name, member count, channel count, role count, and basic settings. Use this to understand the server at a high level.",
    input: empty,
    execute: async () => {
      const rest = discordRest();
      const guild = discordObject<RESTGetAPIGuildResult>(
        await rest.get(Routes.guild(DISCORD_GUILD_ID), {
          query: makeURLSearchParams<RESTGetAPIGuildQuery>({ with_counts: true }),
        }),
        "get guild",
      );
      const icon = responseString.safeParse(guild.icon).data;
      const banner = responseString.safeParse(guild.banner).data;
      return {
        id: guild.id,
        name: guild.name,
        memberCount: guild.approximate_member_count,
        presenceCount: guild.approximate_presence_count,
        ownerId: guild.owner_id,
        description: guild.description ?? null,
        icon:
          icon === undefined
            ? null
            : `https://cdn.discordapp.com/icons/${DISCORD_GUILD_ID}/${icon}.png`,
        banner:
          banner === undefined
            ? null
            : `https://cdn.discordapp.com/banners/${DISCORD_GUILD_ID}/${banner}.png`,
        boostLevel: guild.premium_tier,
        boostCount: guild.premium_subscription_count,
        verificationLevel: guild.verification_level,
        createdAt: guild.id,
      };
    },
  }),

  update_guild: defineTool({
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Update core Discord server settings — name, description, icon, banner, afk channel, verification level, etc. Only provide the fields you want to change.",
    input: z.strictObject({
      name: z.string().trim().min(2).max(100).optional(),
      description: z.string().max(120).optional(),
      icon: dataUri.nullable().optional(),
      banner: dataUri.nullable().optional(),
      splash: dataUri.nullable().optional(),
      afk_channel_id: discordSnowflakeSchema.nullable().optional(),
      afk_timeout: z.literal([60, 300, 900, 1_800, 3_600]).optional(),
      verification_level: z.int().min(0).max(4).optional(),
      default_message_notifications: z.literal([0, 1]).optional(),
      explicit_content_filter: z.int().min(0).max(2).optional(),
      system_channel_id: discordSnowflakeSchema.nullable().optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      for (const id of [input.afk_channel_id, input.system_channel_id])
        if (id !== undefined && id !== null) await guildChannel(rest, id);
      const guild = discordObject<RESTPatchAPIGuildResult>(
        await rest.patch(Routes.guild(DISCORD_GUILD_ID), {
          body: compact<RESTPatchAPIGuildJSONBody>({
            name: input.name,
            description: input.description,
            icon: input.icon,
            banner: input.banner,
            splash: input.splash,
            afk_channel_id: input.afk_channel_id,
            afk_timeout: input.afk_timeout,
            verification_level: input.verification_level,
            default_message_notifications: input.default_message_notifications,
            explicit_content_filter: input.explicit_content_filter,
            system_channel_id: input.system_channel_id,
          }),
        }),
        "update guild",
      );
      return { id: guild.id, name: guild.name, description: guild.description ?? null };
    },
  }),

  get_guild_preview: defineTool({
    access: { risk: "read" },
    description:
      "Get public preview info for the Discord server — approximate member count, online count, description, features, and splash image.",
    input: empty,
    execute: async () => {
      const rest = discordRest();
      const preview = discordObject<RESTGetAPIGuildPreviewResult>(
        await rest.get(Routes.guildPreview(DISCORD_GUILD_ID)),
        "get guild preview",
      );
      return {
        id: preview.id,
        name: preview.name,
        description: preview.description ?? null,
        memberCount: preview.approximate_member_count,
        onlineCount: preview.approximate_presence_count,
        features: Array.isArray(preview.features) ? preview.features : [],
      };
    },
  }),

  get_vanity_url: defineTool({
    access: { risk: "read" },
    description:
      "Get the Discord server's vanity invite URL (e.g. discord.gg/purduehackers) if one is configured. Returns code and usage count.",
    input: empty,
    execute: async () => {
      const rest = discordRest();
      const vanity = discordObject<RESTGetAPIGuildVanityUrlResult>(
        await rest.get(Routes.guildVanityUrl(DISCORD_GUILD_ID)),
        "get guild vanity URL",
      );
      const code = responseString.safeParse(vanity.code).data;
      return code === undefined
        ? { configured: false }
        : {
            configured: true,
            code,
            url: `https://discord.gg/${code}`,
            uses: vanity.uses,
          };
    },
  }),

  list_events: defineTool({
    access: { risk: "read" },
    description:
      "List all scheduled events in the server. Returns event details including name, description, times, type, location, and attendee count.",
    input: empty,
    execute: async () => {
      const rest = discordRest();
      return discordArray<RESTGetAPIGuildScheduledEventsResult>(
        await rest.get(Routes.guildScheduledEvents(DISCORD_GUILD_ID), {
          query: makeURLSearchParams<RESTGetAPIGuildScheduledEventsQuery>({
            with_user_count: true,
          }),
        }),
        "list guild scheduled events",
      ).map(summarizeEvent);
    },
  }),

  create_event: defineTool({
    access: { risk: "write" },
    description:
      "Create a scheduled event in the server. Supports voice channel events, stage events, and external (location-based) events. External events require an end time and location.",
    input: eventCreate,
    execute: async (input) => {
      const rest = discordRest();
      if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
      const image =
        input.image === undefined
          ? undefined
          : await imageDataUri(input.image, EVENT_IMAGE_MAX_BYTES);
      return summarizeEvent(
        discordObject<RESTPostAPIGuildScheduledEventResult>(
          await rest.post(Routes.guildScheduledEvents(DISCORD_GUILD_ID), {
            body: compact<RESTPostAPIGuildScheduledEventJSONBody>({
              name: input.name,
              description: input.description,
              scheduled_start_time: input.scheduled_start,
              scheduled_end_time: input.scheduled_end,
              privacy_level: GuildScheduledEventPrivacyLevel.GuildOnly,
              entity_type: EVENT_TYPES[input.type],
              channel_id: input.channel_id,
              entity_metadata:
                input.location === undefined ? undefined : { location: input.location },
              image,
            }),
          }),
          "create guild scheduled event",
        ),
      );
    },
  }),

  edit_event: defineTool({
    access: { risk: "write" },
    description:
      "Edit a scheduled event's name, description, times, location, image, status, or channel. Use status to start ('active'), end ('completed'), or cancel ('canceled') an event.",
    input: z.strictObject({
      event_id: discordSnowflakeSchema,
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().max(1_000).optional(),
      scheduled_start: isoDateTime.optional(),
      scheduled_end: isoDateTime.optional(),
      location: z.string().trim().min(1).max(100).optional(),
      image: httpUrl.optional(),
      status: z.enum(["scheduled", "active", "completed", "canceled"]).optional(),
      channel_id: discordSnowflakeSchema.nullable().optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      if (input.channel_id !== undefined && input.channel_id !== null)
        await guildChannel(rest, input.channel_id);
      const image =
        input.image === undefined
          ? undefined
          : await imageDataUri(input.image, EVENT_IMAGE_MAX_BYTES);
      return summarizeEvent(
        discordObject<RESTPatchAPIGuildScheduledEventResult>(
          await rest.patch(Routes.guildScheduledEvent(DISCORD_GUILD_ID, input.event_id), {
            body: compact<RESTPatchAPIGuildScheduledEventJSONBody>({
              name: input.name,
              description: input.description,
              scheduled_start_time: input.scheduled_start,
              scheduled_end_time: input.scheduled_end,
              entity_metadata:
                input.location === undefined ? undefined : { location: input.location },
              image,
              status: input.status === undefined ? undefined : EVENT_STATUSES[input.status],
              channel_id: input.channel_id,
            }),
          }),
          "edit guild scheduled event",
        ),
      );
    },
  }),

  delete_event: defineTool({
    access: { risk: "destructive" },
    description:
      "Delete a scheduled event. This is irreversible and will notify users who have indicated interest.",
    input: z.strictObject({ event_id: discordSnowflakeSchema }),
    execute: async (input) => {
      const rest = discordRest();
      const event = discordObject<RESTGetAPIGuildScheduledEventResult>(
        await rest.get(Routes.guildScheduledEvent(DISCORD_GUILD_ID, input.event_id)),
        "get guild scheduled event",
      );
      await rest.delete(Routes.guildScheduledEvent(DISCORD_GUILD_ID, input.event_id));
      return { success: true, deleted: event.name ?? input.event_id };
    },
  }),

  list_invites: defineTool({
    access: { risk: "read", minRole: "admin" },
    description:
      "List all active server invites with their codes, channels, creators, usage counts, and expiry dates.",
    input: empty,
    execute: async () => {
      const rest = discordRest();
      return discordArray<RESTGetAPIGuildInvitesResult>(
        await rest.get(Routes.guildInvites(DISCORD_GUILD_ID)),
        "list guild invites",
      ).map(summarizeInvite);
    },
  }),

  create_invite: defineTool({
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Create a new server invite for a specific channel. Returns the invite code and URL.",
    input: z.strictObject({
      channel_id: channelId,
      max_age: z.int().min(0).max(604_800).optional(),
      max_uses: z.int().min(0).max(100).optional(),
      temporary: z.boolean().optional(),
      unique: z.boolean().optional(),
      reason: reason.optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      const invite = discordObject<RESTPostAPIChannelInviteResult>(
        await rest.post(Routes.channelInvites(input.channel_id), {
          body: compact<RESTPostAPIChannelInviteJSONBody>({
            max_age: input.max_age,
            max_uses: input.max_uses,
            temporary: input.temporary,
            unique: input.unique,
          }),
          reason: input.reason,
        }),
        "create channel invite",
      );
      const code = responseString.safeParse(invite.code).data;
      return {
        code: invite.code,
        url: code === undefined ? null : `https://discord.gg/${code}`,
        channelId: invite.channel?.id ?? input.channel_id,
        maxAge: invite.max_age,
        maxUses: invite.max_uses,
        temporary: invite.temporary,
        expiresAt: invite.expires_at ?? null,
      };
    },
  }),

  delete_invite: defineTool({
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Revoke an active invite by its code. Use list_invites first to find available codes.",
    input: z.strictObject({
      code: z
        .stringFormat("discord-invite-code", /^[A-Za-z0-9_-]+$/u)
        .min(2)
        .max(100),
      reason: reason.optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await requireGuildInvite(rest, input.code);
      await rest.delete(Routes.invite(input.code), { reason: input.reason });
      return { success: true, deleted: input.code };
    },
  }),

  get_audit_log: defineTool({
    access: { risk: "read" },
    description:
      "Get the Discord server's audit log. Use to find who performed admin actions (role changes, bans, channel edits, etc.). Returns entries with action type, executor, target, timestamps, and optional reason. Supports pagination and filtering by user/action type.",
    input: z.strictObject({
      limit: z.int().min(1).max(100).optional(),
      user_id: discordSnowflakeSchema.optional(),
      action_type: z.int().min(1).max(255).optional(),
      before: discordSnowflakeSchema.optional(),
      after: discordSnowflakeSchema.optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      const raw = discordObject<RESTGetAPIAuditLogResult>(
        await rest.get(Routes.guildAuditLog(DISCORD_GUILD_ID), {
          query: makeURLSearchParams<RESTGetAPIAuditLogQuery>({
            limit: input.limit ?? 50,
            ...(input.user_id === undefined ? {} : { user_id: input.user_id }),
            ...(input.action_type === undefined ? {} : { action_type: input.action_type }),
            ...(input.before === undefined ? {} : { before: input.before }),
            ...(input.after === undefined ? {} : { after: input.after }),
          }),
        }),
        "get audit log",
      );
      const userNames = new Map(
        discordArray<RESTGetAPIAuditLogResult["users"]>(raw.users, "get audit log users").map(
          (user) => [user.id, user.global_name ?? user.username],
        ),
      );
      return discordArray<RESTGetAPIAuditLogResult["audit_log_entries"]>(
        raw.audit_log_entries,
        "get audit log entries",
      ).map((entry) => {
        const executorId = responseString.safeParse(entry.user_id).data;
        return {
          id: entry.id,
          actionType: entry.action_type,
          executor: executorId === undefined ? null : (userNames.get(executorId) ?? executorId),
          targetId: entry.target_id ?? null,
          reason: entry.reason ?? null,
          changes: entry.changes,
        };
      });
    },
  }),

  list_auto_mod_rules: defineTool({
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
  }),

  get_auto_mod_rule: defineTool({
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
  }),

  create_auto_mod_rule: defineTool({
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
  }),

  update_auto_mod_rule: defineTool({
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
  }),

  delete_auto_mod_rule: defineTool({
    access: { risk: "destructive" },
    description: "Delete an auto-moderation rule. Cannot be undone.",
    input: z.strictObject({ rule_id: discordSnowflakeSchema }),
    execute: async (input) => {
      const rest = discordRest();
      await rest.delete(Routes.guildAutoModerationRule(DISCORD_GUILD_ID, input.rule_id));
      return { deleted: true, rule_id: input.rule_id };
    },
  }),
} as const;
