/** Strict semantic agent → bot command contract for the single managed Discord guild. */

import { z } from "zod";

import { InvalidInput } from "./errors.ts";
import { Result } from "./result/index.ts";

export const DISCORD_COMMAND_ROUTE = "/internal/discord-command";

export const discordSnowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/u, "expected a Discord snowflake");
const reason = z.string().min(1).max(512);
const channelName = z.string().min(1).max(100);
const isoDateTime = z.iso.datetime({ offset: true });
const httpUrl = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.username === "" &&
      parsed.password === ""
    );
  }, "expected an HTTP(S) URL without embedded credentials");
const dataUri = z
  .string()
  .max(8_000_000)
  .regex(/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/iu, "expected an image data URI");
const hexColor = z.string().regex(/^#[0-9A-F]{6}$/iu, "expected a six-digit hex color");
const slowmode = z.number().int().min(0).max(21_600);
const autoArchiveDuration = z.enum(["60", "1440", "4320", "10080"]);

const empty = z.strictObject({});
const channelId = discordSnowflakeSchema.describe("Channel ID");
const messageId = discordSnowflakeSchema.describe("Message ID");
const memberId = discordSnowflakeSchema.describe("Discord user ID");
const roleId = discordSnowflakeSchema.describe("Role ID");

const autoModMetadata = z.strictObject({
  keyword_filter: z.array(z.string().min(1).max(60)).max(1_000).optional(),
  regex_patterns: z.array(z.string().min(1).max(260)).max(10).optional(),
  presets: z
    .array(z.union([z.literal(1), z.literal(2), z.literal(3)]))
    .max(3)
    .optional(),
  allow_list: z.array(z.string().min(1).max(60)).max(100).optional(),
  mention_total_limit: z.number().int().min(1).max(50).optional(),
  mention_raid_protection_enabled: z.boolean().optional(),
});
const autoModActionMetadata = z.strictObject({
  channel_id: discordSnowflakeSchema.optional(),
  duration_seconds: z.number().int().min(1).max(2_419_200).optional(),
  custom_message: z.string().min(1).max(150).optional(),
});
const autoModAction = z
  .strictObject({
    type: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    metadata: autoModActionMetadata.optional(),
  })
  .superRefine((action, ctx) => {
    const metadata = action.metadata;
    if (action.type === 2 && metadata?.channel_id === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["metadata", "channel_id"],
        message: "alert actions require channel_id",
      });
    }
    if (action.type === 3 && metadata?.duration_seconds === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["metadata", "duration_seconds"],
        message: "timeout actions require duration_seconds",
      });
    }
    if (action.type !== 2 && metadata?.channel_id !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["metadata", "channel_id"],
        message: "channel_id is only valid for alert actions",
      });
    }
    if (action.type !== 3 && metadata?.duration_seconds !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["metadata", "duration_seconds"],
        message: "duration_seconds is only valid for timeout actions",
      });
    }
  });

const eventCreate = z
  .strictObject({
    name: z.string().min(1).max(100),
    description: z.string().max(1_000).optional(),
    scheduled_start: isoDateTime,
    scheduled_end: isoDateTime.optional(),
    type: z.enum(["voice", "stage", "external"]).default("external"),
    channel_id: discordSnowflakeSchema.optional(),
    location: z.string().min(1).max(100).optional(),
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

/** Every key is an allowlisted semantic operation; every value rejects unknown input keys. */
export const DISCORD_COMMAND_INPUT_SCHEMAS = {
  get_audit_log: z.strictObject({
    limit: z.number().int().min(1).max(100).optional(),
    user_id: discordSnowflakeSchema.optional(),
    action_type: z.number().int().min(1).max(255).optional(),
    before: discordSnowflakeSchema.optional(),
    after: discordSnowflakeSchema.optional(),
  }),
  list_auto_mod_rules: empty,
  get_auto_mod_rule: z.strictObject({ rule_id: discordSnowflakeSchema }),
  create_auto_mod_rule: z.strictObject({
    name: z.string().min(1).max(100),
    event_type: z.union([z.literal(1), z.literal(2)]),
    trigger_type: z.union([z.literal(1), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
    trigger_metadata: autoModMetadata.optional(),
    actions: z.array(autoModAction).min(1).max(3),
    enabled: z.boolean().optional(),
    exempt_roles: z.array(discordSnowflakeSchema).max(20).optional(),
    exempt_channels: z.array(discordSnowflakeSchema).max(50).optional(),
  }),
  update_auto_mod_rule: z.strictObject({
    rule_id: discordSnowflakeSchema,
    name: z.string().min(1).max(100).optional(),
    event_type: z.union([z.literal(1), z.literal(2)]).optional(),
    trigger_metadata: autoModMetadata.optional(),
    actions: z.array(autoModAction).min(1).max(3).optional(),
    enabled: z.boolean().optional(),
    exempt_roles: z.array(discordSnowflakeSchema).max(20).optional(),
    exempt_channels: z.array(discordSnowflakeSchema).max(50).optional(),
  }),
  delete_auto_mod_rule: z.strictObject({ rule_id: discordSnowflakeSchema }),

  get_server_info: empty,
  list_channels: empty,
  list_roles: empty,
  search_members: z.strictObject({
    query: z.string().min(1).max(100),
    limit: z.number().int().min(1).max(100).default(10),
  }),

  create_channel: z.strictObject({
    name: channelName,
    type: z.enum(["text", "voice", "category", "announcement", "forum", "stage"]).default("text"),
    topic: z.string().max(1_024).optional(),
    parent_id: discordSnowflakeSchema.optional(),
    nsfw: z.boolean().optional(),
    slowmode: slowmode.optional(),
    position: z.number().int().min(0).optional(),
    bitrate: z.number().int().min(8_000).max(512_000).optional(),
    user_limit: z.number().int().min(0).max(99).optional(),
    rtc_region: z.string().min(1).max(100).optional(),
    video_quality_mode: z.enum(["auto", "full"]).optional(),
    default_auto_archive_duration: autoArchiveDuration.optional(),
    default_thread_slowmode: slowmode.optional(),
  }),
  edit_channel: z.strictObject({
    channel_id: channelId,
    name: channelName.optional(),
    topic: z.string().max(1_024).optional(),
    parent_id: discordSnowflakeSchema.nullable().optional(),
    nsfw: z.boolean().optional(),
    slowmode: slowmode.optional(),
    position: z.number().int().min(0).optional(),
    bitrate: z.number().int().min(8_000).max(512_000).optional(),
    user_limit: z.number().int().min(0).max(99).optional(),
    rtc_region: z.string().min(1).max(100).nullable().optional(),
    video_quality_mode: z.enum(["auto", "full"]).optional(),
    default_auto_archive_duration: autoArchiveDuration.optional(),
    default_thread_slowmode: slowmode.optional(),
  }),
  get_channel: z.strictObject({ channel_id: channelId }),
  follow_announcement_channel: z.strictObject({
    source_channel_id: channelId,
    target_channel_id: channelId,
  }),
  delete_channel: z.strictObject({ channel_id: channelId }),

  list_emojis: empty,
  create_emoji: z.strictObject({
    name: z
      .string()
      .min(2)
      .max(32)
      .regex(/^[A-Za-z0-9_]+$/u),
    url: httpUrl,
    roles: z.array(roleId).max(100).optional(),
  }),
  edit_emoji: z.strictObject({
    emoji_id: discordSnowflakeSchema,
    name: z
      .string()
      .min(2)
      .max(32)
      .regex(/^[A-Za-z0-9_]+$/u)
      .optional(),
    roles: z.array(roleId).max(100).optional(),
  }),
  delete_emoji: z.strictObject({ emoji_id: discordSnowflakeSchema }),

  list_events: empty,
  create_event: eventCreate,
  edit_event: z.strictObject({
    event_id: discordSnowflakeSchema,
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(1_000).optional(),
    scheduled_start: isoDateTime.optional(),
    scheduled_end: isoDateTime.optional(),
    location: z.string().min(1).max(100).optional(),
    image: httpUrl.optional(),
    status: z.enum(["scheduled", "active", "completed", "canceled"]).optional(),
    channel_id: discordSnowflakeSchema.nullable().optional(),
  }),
  delete_event: z.strictObject({ event_id: discordSnowflakeSchema }),

  update_guild: z.strictObject({
    name: z.string().min(2).max(100).optional(),
    description: z.string().max(120).optional(),
    icon: dataUri.nullable().optional(),
    banner: dataUri.nullable().optional(),
    splash: dataUri.nullable().optional(),
    afk_channel_id: discordSnowflakeSchema.nullable().optional(),
    afk_timeout: z
      .union([z.literal(60), z.literal(300), z.literal(900), z.literal(1800), z.literal(3600)])
      .optional(),
    verification_level: z.number().int().min(0).max(4).optional(),
    default_message_notifications: z.union([z.literal(0), z.literal(1)]).optional(),
    explicit_content_filter: z.number().int().min(0).max(2).optional(),
    system_channel_id: discordSnowflakeSchema.nullable().optional(),
  }),
  get_guild_preview: empty,
  get_vanity_url: empty,

  list_invites: empty,
  create_invite: z.strictObject({
    channel_id: channelId,
    max_age: z.number().int().min(0).max(604_800).optional(),
    max_uses: z.number().int().min(0).max(100).optional(),
    temporary: z.boolean().optional(),
    unique: z.boolean().optional(),
    reason: reason.optional(),
  }),
  delete_invite: z.strictObject({
    code: z
      .string()
      .min(2)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/u),
    reason: reason.optional(),
  }),

  ban_member: z.strictObject({
    member_id: memberId,
    delete_message_seconds: z.number().int().min(0).max(604_800).optional(),
    reason: reason.optional(),
  }),
  unban_member: z.strictObject({ user_id: memberId, reason: reason.optional() }),
  list_bans: z.strictObject({
    limit: z.number().int().min(1).max(1_000).optional(),
    before: discordSnowflakeSchema.optional(),
    after: discordSnowflakeSchema.optional(),
  }),
  kick_member: z.strictObject({ member_id: memberId, reason: reason.optional() }),
  timeout_member: z.strictObject({
    member_id: memberId,
    duration_seconds: z.number().int().min(1).max(2_419_200),
    reason: reason.optional(),
  }),
  clear_timeout: z.strictObject({ member_id: memberId, reason: reason.optional() }),

  get_member: z.strictObject({ member_id: memberId }),
  set_nickname: z.strictObject({
    member_id: memberId,
    nickname: z.string().min(1).max(32).nullable(),
  }),

  add_member_to_platform: z.strictObject({
    channel_id: channelId,
    max_age_seconds: z.number().int().min(0).max(604_800).optional(),
    max_uses: z.number().int().min(0).max(100).optional(),
    reason: reason.optional(),
  }),
  remove_member_from_platform: z.strictObject({ member_id: memberId, reason: reason.optional() }),

  send_message: z.strictObject({
    channel_id: channelId,
    content: z.string().min(1).max(2_000),
  }),
  delete_message: z.strictObject({ channel_id: channelId, message_id: messageId }),
  pin_message: z.strictObject({ channel_id: channelId, message_id: messageId }),
  unpin_message: z.strictObject({ channel_id: channelId, message_id: messageId }),
  add_reaction: z.strictObject({
    channel_id: channelId,
    message_id: messageId,
    emoji: z.string().min(1).max(100),
  }),
  get_message: z.strictObject({ channel_id: channelId, message_id: messageId }),
  edit_message: z.strictObject({
    channel_id: channelId,
    message_id: messageId,
    content: z.string().min(1).max(2_000),
  }),
  bulk_delete_messages: z.strictObject({
    channel_id: channelId,
    message_ids: z.array(messageId).min(2).max(100),
  }),
  crosspost_message: z.strictObject({ channel_id: channelId, message_id: messageId }),
  remove_reaction: z.strictObject({
    channel_id: channelId,
    message_id: messageId,
    emoji: z.string().min(1).max(100),
    user_id: z.union([discordSnowflakeSchema, z.literal("@me")]),
  }),
  remove_all_reactions: z.strictObject({ channel_id: channelId, message_id: messageId }),
  fetch_messages: z.strictObject({
    channel_id: channelId,
    limit: z.number().int().min(1).max(100).default(25),
    before: discordSnowflakeSchema.optional(),
    after: discordSnowflakeSchema.optional(),
  }),

  create_role: z.strictObject({
    name: z.string().min(1).max(100),
    color: hexColor.optional(),
    hoist: z.boolean().optional(),
    mentionable: z.boolean().optional(),
    position: z.number().int().min(1).optional(),
    icon: httpUrl.optional(),
    unicode_emoji: z.string().min(1).max(32).optional(),
  }),
  edit_role: z.strictObject({
    role_id: roleId,
    name: z.string().min(1).max(100).optional(),
    color: hexColor.optional(),
    hoist: z.boolean().optional(),
    mentionable: z.boolean().optional(),
    position: z.number().int().min(1).optional(),
    icon: httpUrl.nullable().optional(),
    unicode_emoji: z.string().min(1).max(32).nullable().optional(),
  }),
  delete_role: z.strictObject({ role_id: roleId }),
  assign_role: z.strictObject({ member_id: memberId, role_id: roleId }),
  remove_role: z.strictObject({ member_id: memberId, role_id: roleId }),

  list_stickers: empty,
  create_sticker: z.strictObject({
    name: z.string().min(2).max(30),
    description: z.string().max(100).optional(),
    tags: z.string().min(2).max(200),
    url: httpUrl,
  }),
  edit_sticker: z.strictObject({
    sticker_id: discordSnowflakeSchema,
    name: z.string().min(2).max(30).optional(),
    description: z.string().max(100).optional(),
    tags: z.string().min(2).max(200).optional(),
  }),
  delete_sticker: z.strictObject({ sticker_id: discordSnowflakeSchema }),

  list_threads: z.strictObject({
    channel_id: channelId.optional(),
    include_archived: z.boolean().default(false),
  }),
  create_thread: z.strictObject({
    channel_id: channelId,
    name: z.string().min(1).max(100),
    message_id: messageId.optional(),
    auto_archive_duration: autoArchiveDuration.optional(),
    type: z.enum(["public", "private"]).default("public"),
    slowmode: slowmode.optional(),
    invitable: z.boolean().optional(),
  }),
  edit_thread: z.strictObject({
    thread_id: discordSnowflakeSchema,
    name: z.string().min(1).max(100).optional(),
    archived: z.boolean().optional(),
    locked: z.boolean().optional(),
    auto_archive_duration: autoArchiveDuration.optional(),
    slowmode: slowmode.optional(),
    invitable: z.boolean().optional(),
  }),
  delete_thread: z.strictObject({ thread_id: discordSnowflakeSchema }),

  list_webhooks: z.strictObject({ channel_id: channelId.optional() }),
  create_webhook: z.strictObject({
    channel_id: channelId,
    name: z.string().min(1).max(80),
    avatar: httpUrl.optional(),
  }),
  edit_webhook: z.strictObject({
    webhook_id: discordSnowflakeSchema,
    name: z.string().min(1).max(80).optional(),
    avatar: httpUrl.optional(),
    channel_id: channelId.optional(),
  }),
  delete_webhook: z.strictObject({ webhook_id: discordSnowflakeSchema }),
} as const;

export type DiscordCommandOperation = keyof typeof DISCORD_COMMAND_INPUT_SCHEMAS;

const auditEntryOutput = z.strictObject({
  id: discordSnowflakeSchema,
  actionType: z.number().int(),
  executor: z.string().nullable(),
  targetId: z.string().nullable(),
  reason: z.string().nullable(),
  changes: z.array(z.json()).optional(),
});
const autoModRuleOutput = z.strictObject({
  id: discordSnowflakeSchema,
  name: z.string(),
  eventType: z.number().int(),
  triggerType: z.number().int(),
  enabled: z.boolean(),
  triggerMetadata: z.json(),
  actions: z.array(z.json()),
  exemptRoles: z.array(discordSnowflakeSchema),
  exemptChannels: z.array(discordSnowflakeSchema),
});
const channelOutput = z.strictObject({
  id: discordSnowflakeSchema,
  name: z.string(),
  type: z.string(),
  topic: z.string().nullable().optional(),
  parentId: discordSnowflakeSchema.nullable().optional(),
  position: z.number().int(),
});
const memberOutput = z.strictObject({
  id: discordSnowflakeSchema,
  username: z.string(),
  displayName: z.string(),
  nickname: z.string().nullable(),
  roles: z.array(discordSnowflakeSchema),
  joinedAt: z.string().nullable(),
  isBot: z.boolean(),
});
const eventOutput = z.strictObject({
  id: discordSnowflakeSchema,
  name: z.string(),
  description: z.string().nullable(),
  scheduledStartAt: z.string().nullable(),
  scheduledEndAt: z.string().nullable(),
  status: z.number().int(),
  entityType: z.number().int(),
  channelId: discordSnowflakeSchema.nullable(),
  location: z.string().nullable(),
  userCount: z.number().int().nullable(),
  creatorId: discordSnowflakeSchema.nullable(),
  image: httpUrl.nullable(),
});
const emojiOutput = z.strictObject({
  id: discordSnowflakeSchema.nullable(),
  name: z.string().nullable(),
  animated: z.boolean(),
  url: httpUrl.nullable(),
  roles: z.array(discordSnowflakeSchema),
  createdAt: discordSnowflakeSchema.nullable(),
});
const stickerOutput = z.strictObject({
  id: discordSnowflakeSchema,
  name: z.string(),
  description: z.string().nullable(),
  tags: z.string(),
  formatType: z.number().int(),
  available: z.boolean().optional(),
  url: httpUrl,
});
const threadOutput = z.strictObject({
  id: discordSnowflakeSchema,
  name: z.string(),
  parentId: discordSnowflakeSchema.nullable(),
  archived: z.boolean(),
  locked: z.boolean(),
  autoArchiveDuration: z.number().int().nullable(),
  messageCount: z.number().int(),
  memberCount: z.number().int(),
  createdAt: z.string().nullable(),
  type: z.string(),
});
const webhookOutput = z.strictObject({
  id: discordSnowflakeSchema,
  name: z.string().nullable(),
  channelId: discordSnowflakeSchema.nullable(),
  avatar: httpUrl.nullable(),
  createdAt: discordSnowflakeSchema,
});
const messageOutput = z.strictObject({
  id: discordSnowflakeSchema,
  author: z.string(),
  authorId: discordSnowflakeSchema,
  isBot: z.boolean(),
  content: z.string(),
  timestamp: z.string(),
  editedTimestamp: z.string().nullable(),
  pinned: z.boolean(),
  attachments: z.array(z.strictObject({ name: z.string(), url: httpUrl })),
  embeds: z.number().int().nonnegative(),
});
const inviteOutput = z.strictObject({
  code: z.string(),
  channel: z
    .strictObject({ id: discordSnowflakeSchema, name: z.string().nullable().optional() })
    .nullable(),
  inviter: z.strictObject({ id: discordSnowflakeSchema, username: z.string() }).nullable(),
  uses: z.number().int().optional(),
  maxUses: z.number().int(),
  maxAge: z.number().int(),
  temporary: z.boolean(),
  expiresAt: z.string().nullable(),
});
const compactInviteOutput = z.strictObject({
  code: z.string(),
  url: httpUrl.nullable(),
  channelId: discordSnowflakeSchema.optional(),
  maxAge: z.number().int(),
  maxUses: z.number().int(),
  temporary: z.boolean().optional(),
  expiresAt: z.string().nullable(),
});
const roleOutput = z.strictObject({
  id: discordSnowflakeSchema,
  name: z.string(),
  color: hexColor,
  position: z.number().int(),
});
const successDeletedOutput = z.strictObject({ success: z.literal(true), deleted: z.string() });

/** Strict project-owned bot → agent summaries, keyed by the unchanged semantic operation set. */
export const DISCORD_COMMAND_OUTPUT_SCHEMAS = {
  get_audit_log: z.array(auditEntryOutput),
  list_auto_mod_rules: z.array(autoModRuleOutput),
  get_auto_mod_rule: autoModRuleOutput,
  create_auto_mod_rule: autoModRuleOutput,
  update_auto_mod_rule: autoModRuleOutput,
  delete_auto_mod_rule: z.strictObject({
    deleted: z.literal(true),
    rule_id: discordSnowflakeSchema,
  }),
  get_server_info: z.strictObject({
    id: discordSnowflakeSchema,
    name: z.string(),
    memberCount: z.number().int(),
    presenceCount: z.number().int(),
    ownerId: discordSnowflakeSchema,
    description: z.string().nullable(),
    icon: httpUrl.nullable(),
    banner: httpUrl.nullable(),
    boostLevel: z.number().int(),
    boostCount: z.number().int().optional(),
    verificationLevel: z.number().int(),
    createdAt: discordSnowflakeSchema,
  }),
  list_channels: z.array(
    z.strictObject({
      category: z
        .strictObject({
          id: discordSnowflakeSchema,
          name: z.string(),
          position: z.number().int(),
        })
        .nullable(),
      channels: z.array(channelOutput),
    }),
  ),
  list_roles: z.array(
    roleOutput.extend({
      mentionable: z.boolean(),
      hoist: z.boolean(),
      managed: z.boolean(),
      isEveryone: z.boolean(),
    }),
  ),
  search_members: z.array(memberOutput),
  create_channel: channelOutput,
  edit_channel: channelOutput,
  get_channel: channelOutput,
  follow_announcement_channel: z.strictObject({
    followed: z.literal(true),
    source: discordSnowflakeSchema,
    target: discordSnowflakeSchema,
    webhook_id: discordSnowflakeSchema,
  }),
  delete_channel: successDeletedOutput,
  list_emojis: z.array(emojiOutput),
  create_emoji: emojiOutput,
  edit_emoji: emojiOutput,
  delete_emoji: successDeletedOutput,
  list_events: z.array(eventOutput),
  create_event: eventOutput,
  edit_event: eventOutput,
  delete_event: successDeletedOutput,
  update_guild: z.strictObject({
    id: discordSnowflakeSchema,
    name: z.string(),
    description: z.string().nullable(),
  }),
  get_guild_preview: z.strictObject({
    id: discordSnowflakeSchema,
    name: z.string(),
    description: z.string().nullable(),
    memberCount: z.number().int(),
    onlineCount: z.number().int(),
    features: z.array(z.string()),
  }),
  get_vanity_url: z.discriminatedUnion("configured", [
    z.strictObject({ configured: z.literal(false) }),
    z.strictObject({
      configured: z.literal(true),
      code: z.string(),
      url: httpUrl,
      uses: z.number().int(),
    }),
  ]),
  list_invites: z.array(inviteOutput),
  create_invite: compactInviteOutput,
  delete_invite: successDeletedOutput,
  ban_member: z.strictObject({ banned: z.literal(true), member_id: discordSnowflakeSchema }),
  unban_member: z.strictObject({ unbanned: z.literal(true), user_id: discordSnowflakeSchema }),
  list_bans: z.array(
    z.strictObject({
      userId: discordSnowflakeSchema,
      username: z.string(),
      reason: z.string().nullable(),
    }),
  ),
  kick_member: z.strictObject({ kicked: z.literal(true), member_id: discordSnowflakeSchema }),
  timeout_member: z.strictObject({
    timeout_until: z.string(),
    member_id: discordSnowflakeSchema,
  }),
  clear_timeout: z.strictObject({
    timeout_cleared: z.literal(true),
    member_id: discordSnowflakeSchema,
  }),
  get_member: z.union([
    memberOutput.extend({ premiumSince: z.string().nullable(), avatar: httpUrl.nullable() }),
    z.strictObject({ error: z.literal("Member not found") }),
  ]),
  set_nickname: z.strictObject({
    success: z.literal(true),
    member: discordSnowflakeSchema,
    nickname: z.string().nullable(),
  }),
  add_member_to_platform: compactInviteOutput.omit({ channelId: true, temporary: true }),
  remove_member_from_platform: z.strictObject({
    removed: z.literal(true),
    member_id: discordSnowflakeSchema,
  }),
  send_message: z.strictObject({
    id: discordSnowflakeSchema,
    channelId: discordSnowflakeSchema,
    content: z.string(),
  }),
  delete_message: z.strictObject({ success: z.literal(true), deleted: discordSnowflakeSchema }),
  pin_message: z.strictObject({ success: z.literal(true), pinned: discordSnowflakeSchema }),
  unpin_message: z.strictObject({ success: z.literal(true), unpinned: discordSnowflakeSchema }),
  add_reaction: z.strictObject({ success: z.literal(true), reacted: z.string() }),
  get_message: messageOutput,
  edit_message: z.strictObject({ id: discordSnowflakeSchema, content: z.string() }),
  bulk_delete_messages: z.strictObject({
    deleted: z.number().int().nonnegative(),
    message_ids: z.array(discordSnowflakeSchema),
  }),
  crosspost_message: z.strictObject({ id: discordSnowflakeSchema, crossposted: z.literal(true) }),
  remove_reaction: z.strictObject({ removed: z.literal(true) }),
  remove_all_reactions: z.strictObject({ cleared: z.literal(true) }),
  fetch_messages: z.array(messageOutput),
  create_role: roleOutput,
  edit_role: roleOutput,
  delete_role: z.union([
    successDeletedOutput,
    z.strictObject({ error: z.literal("Role not found") }),
  ]),
  assign_role: z.strictObject({
    success: z.literal(true),
    member: discordSnowflakeSchema,
    role: discordSnowflakeSchema,
  }),
  remove_role: z.strictObject({
    success: z.literal(true),
    member: discordSnowflakeSchema,
    role: discordSnowflakeSchema,
  }),
  list_stickers: z.array(stickerOutput),
  create_sticker: stickerOutput,
  edit_sticker: stickerOutput,
  delete_sticker: z.strictObject({
    deleted: z.literal(true),
    sticker_id: discordSnowflakeSchema,
  }),
  list_threads: z.array(threadOutput),
  create_thread: threadOutput,
  edit_thread: threadOutput,
  delete_thread: successDeletedOutput,
  list_webhooks: z.array(webhookOutput),
  create_webhook: webhookOutput,
  edit_webhook: webhookOutput,
  delete_webhook: successDeletedOutput,
} as const satisfies Record<DiscordCommandOperation, z.ZodType>;

export type DiscordCommandOutput<K extends DiscordCommandOperation> = z.output<
  (typeof DISCORD_COMMAND_OUTPUT_SCHEMAS)[K]
>;

export function decodeDiscordCommandOutput<K extends DiscordCommandOperation>(
  operation: K,
  value: unknown,
): Result<DiscordCommandOutput<K>, InvalidInput> {
  const parsed = DISCORD_COMMAND_OUTPUT_SCHEMAS[operation].safeParse(value);
  return parsed.success
    ? // oxlint-disable-next-line typescript/consistent-type-assertions -- operation indexes the corresponding output schema.
      Result.ok(parsed.data as DiscordCommandOutput<K>)
    : invalid(`Discord ${operation} output`, parsed.error);
}

export type DiscordCommand = {
  [K in DiscordCommandOperation]: {
    readonly operation: K;
    readonly input: z.output<(typeof DISCORD_COMMAND_INPUT_SCHEMAS)[K]>;
  };
}[DiscordCommandOperation];

export const DISCORD_COMMAND_OPERATIONS = Object.freeze(
  // oxlint-disable-next-line typescript/consistent-type-assertions -- Object.keys loses the closed internal registry's key union.
  Object.keys(DISCORD_COMMAND_INPUT_SCHEMAS) as DiscordCommandOperation[],
);

const commandVariants = DISCORD_COMMAND_OPERATIONS.map((operation) =>
  z.strictObject({
    operation: z.literal(operation),
    input: DISCORD_COMMAND_INPUT_SCHEMAS[operation],
  }),
);
export const discordCommandSchema = z.discriminatedUnion(
  "operation",
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the non-empty registry is a Zod discriminated-union tuple at runtime.
  commandVariants as [(typeof commandVariants)[number], ...(typeof commandVariants)[number][]],
);

/** Decode the strict discriminated operation union. */
export function decodeDiscordCommand(value: unknown): Result<DiscordCommand, InvalidInput> {
  const parsed = discordCommandSchema.safeParse(value);
  return parsed.success
    ? // oxlint-disable-next-line typescript/consistent-type-assertions -- generated Zod variants preserve operation/input correlation at runtime.
      Result.ok(parsed.data as DiscordCommand)
    : invalid("Discord command", parsed.error);
}

export const discordCommandResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), data: z.unknown() }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      tag: z.string().min(1).max(100),
      message: z.string().min(1).max(1_000),
    }),
  }),
]);
export type DiscordCommandResponse = z.infer<typeof discordCommandResponseSchema>;

export function decodeDiscordCommandResponse(
  value: unknown,
): Result<DiscordCommandResponse, InvalidInput> {
  const parsed = discordCommandResponseSchema.safeParse(value);
  return parsed.success
    ? Result.ok(parsed.data)
    : invalid("Discord command response", parsed.error);
}

function invalid(subject: string, error: Pick<z.ZodError, "issues">): Result<never, InvalidInput> {
  return Result.err(
    new InvalidInput({
      subject,
      issues: error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`),
    }),
  );
}
