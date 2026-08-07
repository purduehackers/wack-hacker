/** Bot-owned executor for the strict semantic Discord command RPC. */
/* oxlint-disable unicorn/no-null -- Discord's JSON API uses null for explicit absence/field clearing. */

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  decodeDiscordCommandOutput,
  type DiscordCommand,
  type DiscordCommandOperation,
  type DiscordCommandOutput,
} from "@repo/shared/discord-command-wire";
import { RateLimited, Transient, UpstreamError, httpStatusOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  Routes,
  StickerFormatType,
  ThreadAutoArchiveDuration,
  VideoQualityMode,
  makeURLSearchParams,
  type APIThreadChannel,
  type Client,
  type RESTGetAPIAuditLogQuery,
  type RESTPatchAPIAutoModerationRuleJSONBody,
  type RESTPatchAPIChannelJSONBody,
  type RESTPatchAPIChannelMessageJSONBody,
  type RESTPatchAPIGuildEmojiJSONBody,
  type RESTPatchAPIGuildJSONBody,
  type RESTPatchAPIGuildMemberJSONBody,
  type RESTPatchAPIGuildRoleJSONBody,
  type RESTPatchAPIGuildRolePositionsJSONBody,
  type RESTPatchAPIGuildScheduledEventJSONBody,
  type RESTPatchAPIGuildStickerJSONBody,
  type RESTPatchAPIWebhookJSONBody,
  type RESTPostAPIAutoModerationRuleJSONBody,
  type RESTPostAPIChannelFollowersJSONBody,
  type RESTPostAPIChannelInviteJSONBody,
  type RESTPostAPIChannelMessageJSONBody,
  type RESTPostAPIChannelMessagesBulkDeleteJSONBody,
  type RESTPostAPIChannelMessagesThreadsJSONBody,
  type RESTPostAPIChannelThreadsJSONBody,
  type RESTPostAPIChannelWebhookJSONBody,
  type RESTPostAPIGuildChannelJSONBody,
  type RESTPostAPIGuildEmojiJSONBody,
  type RESTPostAPIGuildRoleJSONBody,
  type RESTPostAPIGuildScheduledEventJSONBody,
  type RESTPostAPIGuildStickerFormDataBody,
  type RESTPutAPIGuildBanJSONBody,
  type RESTGetAPIAuditLogResult,
  type RESTGetAPIAutoModerationRuleResult,
  type RESTGetAPIAutoModerationRulesResult,
  type RESTGetAPIChannelMessageResult,
  type RESTGetAPIChannelMessagesQuery,
  type RESTGetAPIChannelMessagesResult,
  type RESTGetAPIChannelThreadsArchivedPublicResult,
  type RESTGetAPIChannelWebhooksResult,
  type RESTGetAPIInviteResult,
  type RESTGetAPIGuildBansQuery,
  type RESTGetAPIGuildBansResult,
  type RESTGetAPIGuildChannelsResult,
  type RESTGetAPIGuildEmojiResult,
  type RESTGetAPIGuildEmojisResult,
  type RESTGetAPIGuildInvitesResult,
  type RESTGetAPIGuildMemberResult,
  type RESTGetAPIGuildMembersSearchQuery,
  type RESTGetAPIGuildMembersSearchResult,
  type RESTGetAPIGuildPreviewResult,
  type RESTGetAPIGuildQuery,
  type RESTGetAPIGuildResult,
  type RESTGetAPIGuildRolesResult,
  type RESTGetAPIGuildScheduledEventResult,
  type RESTGetAPIGuildScheduledEventsQuery,
  type RESTGetAPIGuildScheduledEventsResult,
  type RESTGetAPIGuildStickersResult,
  type RESTGetAPIGuildThreadsResult,
  type RESTGetAPIGuildVanityUrlResult,
  type RESTGetAPIGuildWebhooksResult,
  type RESTPatchAPIChannelMessageResult,
  type RESTPatchAPIGuildEmojiResult,
  type RESTPatchAPIGuildResult,
  type RESTPatchAPIGuildRoleResult,
  type RESTPatchAPIGuildScheduledEventResult,
  type RESTPatchAPIGuildStickerResult,
  type RESTPatchAPIWebhookResult,
  type RESTPostAPIAutoModerationRuleResult,
  type RESTPostAPIChannelFollowersResult,
  type RESTPostAPIChannelInviteResult,
  type RESTPostAPIChannelMessageCrosspostResult,
  type RESTPostAPIChannelMessageResult,
  type RESTPostAPIChannelWebhookResult,
  type RESTPostAPIGuildEmojiResult,
  type RESTPostAPIGuildRoleResult,
  type RESTPostAPIGuildScheduledEventResult,
  type RESTPostAPIGuildStickerResult,
  type RESTAPIGuildChannelResolvable,
} from "discord.js";

const CHANNEL_TYPES = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  announcement: ChannelType.GuildAnnouncement,
  stage: ChannelType.GuildStageVoice,
  forum: ChannelType.GuildForum,
} as const;
const CHANNEL_TYPE_NAMES: Readonly<Record<number, string>> = {
  [ChannelType.GuildText]: "text",
  [ChannelType.GuildVoice]: "voice",
  [ChannelType.GuildCategory]: "category",
  [ChannelType.GuildAnnouncement]: "announcement",
  [ChannelType.AnnouncementThread]: "announcement_thread",
  [ChannelType.PublicThread]: "public_thread",
  [ChannelType.PrivateThread]: "private_thread",
  [ChannelType.GuildStageVoice]: "stage",
  [ChannelType.GuildForum]: "forum",
};
const THREAD_CHANNEL_TYPES = new Set<number>([
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
]);
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
const AUTO_ARCHIVE_DURATIONS = {
  "60": ThreadAutoArchiveDuration.OneHour,
  "1440": ThreadAutoArchiveDuration.OneDay,
  "4320": ThreadAutoArchiveDuration.ThreeDays,
  "10080": ThreadAutoArchiveDuration.OneWeek,
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
type AutoModCreateInput = Extract<
  DiscordCommand,
  { readonly operation: "create_auto_mod_rule" }
>["input"];
type AutoModActionInput = AutoModCreateInput["actions"][number];

function autoModMetadata(
  metadata: AutoModCreateInput["trigger_metadata"],
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
function autoModAction(
  action: AutoModActionInput,
): RESTPostAPIAutoModerationRuleJSONBody["actions"][number] {
  const metadata =
    action.metadata === undefined
      ? undefined
      : compact({
          ...(action.metadata.channel_id === undefined
            ? {}
            : { channel_id: action.metadata.channel_id }),
          ...(action.metadata.duration_seconds === undefined
            ? {}
            : { duration_seconds: action.metadata.duration_seconds }),
          ...(action.metadata.custom_message === undefined
            ? {}
            : { custom_message: action.metadata.custom_message }),
        });
  return compact({
    type: AUTO_MOD_ACTION_TYPES[action.type],
    ...(metadata === undefined ? {} : { metadata }),
  });
}

const IMAGE_TIMEOUT_MS = 15_000;

type DiscordRest = Pick<Client["rest"], "delete" | "get" | "patch" | "post" | "put">;
type DiscordCommandError = RateLimited | Transient | UpstreamError;

function malformedDiscordResponse(endpoint: string): UpstreamError {
  return new UpstreamError({
    service: "discord",
    status: 502,
    detail: `${endpoint} returned a malformed response`,
  });
}
function discordObject<T extends object>(value: unknown, endpoint: string): T {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw malformedDiscordResponse(endpoint);
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- discord.js REST returns unknown; T is the endpoint's exported v10 result.
  return value as T;
}
function discordArray<T extends readonly object[]>(value: unknown, endpoint: string): T {
  if (
    !Array.isArray(value) ||
    value.some((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry))
  ) {
    throw malformedDiscordResponse(endpoint);
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- discord.js REST returns unknown; T is the endpoint's exported v10 result.
  return value as unknown as T;
}
function compact<T extends object>(value: T): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- removing undefined properties preserves the supplied request/output shape.
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
function channelType(value: number): string {
  if (typeof value !== "number") throw malformedDiscordResponse("channel type");
  return CHANNEL_TYPE_NAMES[value] ?? `unknown(${value})`;
}
type GuildChannelResult = RESTAPIGuildChannelResolvable;
function summarizeChannel(channel: GuildChannelResult) {
  return compact({
    id: channel.id,
    name: channel.name,
    type: channelType(channel.type),
    topic: "topic" in channel ? channel.topic : undefined,
    parentId: channel.parent_id ?? undefined,
    position: "position" in channel ? channel.position : undefined,
  });
}
function summarizeMember(member: RESTGetAPIGuildMemberResult) {
  const user = discordObject<RESTGetAPIGuildMemberResult["user"]>(member.user, "guild member user");
  return {
    id: user.id,
    username: user.username,
    displayName: user.global_name ?? user.username,
    nickname: member.nick ?? null,
    roles: member.roles,
    joinedAt: member.joined_at ?? null,
    isBot: user.bot ?? false,
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
      typeof event.id === "string" && typeof event.image === "string"
        ? `https://cdn.discordapp.com/guild-events/${event.id}/${event.image}.png`
        : null,
  };
}
type ThreadResult = APIThreadChannel;
function summarizeThread(thread: ThreadResult) {
  const metadata =
    thread.thread_metadata === undefined
      ? undefined
      : discordObject<NonNullable<ThreadResult["thread_metadata"]>>(
          thread.thread_metadata,
          "thread metadata",
        );
  return {
    id: thread.id,
    name: thread.name,
    parentId: thread.parent_id ?? null,
    archived: metadata?.archived ?? false,
    locked: metadata?.locked ?? false,
    autoArchiveDuration: metadata?.auto_archive_duration ?? null,
    messageCount: thread.message_count ?? 0,
    memberCount: thread.member_count ?? 0,
    createdAt: metadata?.create_timestamp ?? null,
    type: channelType(thread.type),
  };
}
type EmojiResult = RESTGetAPIGuildEmojisResult[number];
function summarizeEmoji(emoji: EmojiResult) {
  const animated = emoji.animated ?? false;
  return {
    id: emoji.id,
    name: emoji.name,
    animated,
    url:
      typeof emoji.id === "string"
        ? `https://cdn.discordapp.com/emojis/${emoji.id}.${animated ? "gif" : "png"}`
        : null,
    roles: emoji.roles ?? [],
    createdAt: emoji.id,
  };
}
type StickerResult = RESTGetAPIGuildStickersResult[number];
function summarizeSticker(sticker: StickerResult) {
  return {
    id: sticker.id,
    name: sticker.name,
    description: sticker.description ?? null,
    tags: sticker.tags,
    formatType: sticker.format_type,
    available: sticker.available,
    url:
      typeof sticker.id === "string"
        ? `https://cdn.discordapp.com/stickers/${sticker.id}.${sticker.format_type === StickerFormatType.Lottie ? "json" : "png"}`
        : null,
  };
}
/** Webhook tokens/URLs are deliberately never projected across the bot boundary. */
type WebhookResult = RESTGetAPIGuildWebhooksResult[number];
function summarizeWebhook(webhook: WebhookResult) {
  return {
    id: webhook.id,
    name: webhook.name,
    channelId: webhook.channel_id,
    avatar:
      typeof webhook.id === "string" && typeof webhook.avatar === "string"
        ? `https://cdn.discordapp.com/avatars/${webhook.id}/${webhook.avatar}.png`
        : null,
    createdAt: webhook.id,
  };
}

function discordError(operation: string) {
  return (cause: unknown): DiscordCommandError => {
    if (
      cause instanceof RateLimited ||
      cause instanceof Transient ||
      cause instanceof UpstreamError
    )
      return cause;
    const status = httpStatusOf(cause);
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (status === 429) return new RateLimited({ service: "discord", retryAfterMs: 1_000 });
    if (status !== undefined && status < 500)
      return new UpstreamError({ service: "discord", status, detail });
    return new Transient({ operation, detail });
  };
}

async function guildChannel(rest: DiscordRest, id: string): Promise<GuildChannelResult> {
  const channel = discordObject<GuildChannelResult>(
    await rest.get(Routes.channel(id)),
    "get channel",
  );
  if (channel.guild_id !== DISCORD_GUILD_ID) {
    throw new UpstreamError({
      service: "discord",
      status: 403,
      detail: "channel is outside the managed guild",
    });
  }
  return channel;
}
async function guildWebhook(rest: DiscordRest, id: string): Promise<WebhookResult> {
  const webhook = discordObject<WebhookResult>(await rest.get(Routes.webhook(id)), "get webhook");
  if (webhook.guild_id !== DISCORD_GUILD_ID) {
    throw new UpstreamError({
      service: "discord",
      status: 403,
      detail: "webhook is outside the managed guild",
    });
  }
  return webhook;
}
async function requireGuildInvite(rest: DiscordRest, code: string): Promise<void> {
  const invite = discordObject<RESTGetAPIInviteResult>(
    await rest.get(Routes.invite(code)),
    "get invite",
  );
  if (invite.guild?.id !== DISCORD_GUILD_ID) {
    throw new UpstreamError({
      service: "discord",
      status: 403,
      detail: "invite is outside the managed guild",
    });
  }
}

async function download(url: string, maxBytes: number, accepted: readonly string[]) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!response.ok) {
    throw new UpstreamError({
      service: "image-source",
      status: response.status,
      detail: "image could not be fetched",
    });
  }
  const contentType =
    (response.headers.get("content-type") ?? "application/octet-stream").split(";", 1)[0] ?? "";
  if (!accepted.includes(contentType)) {
    throw new UpstreamError({
      service: "image-source",
      status: 415,
      detail: `unsupported content type ${contentType}`,
    });
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UpstreamError({
      service: "image-source",
      status: 413,
      detail: "image exceeds the size limit",
    });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new UpstreamError({
      service: "image-source",
      status: 413,
      detail: "image exceeds the size limit",
    });
  }
  return { bytes, contentType };
}
async function imageDataUri(url: string, maxBytes = 256 * 1_024): Promise<string> {
  const image = await download(url, maxBytes, [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ]);
  return `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

// oxlint-disable-next-line oxclippy/too-many-lines, oxclippy/cognitive-complexity -- exhaustive 68-operation allowlist is intentionally centralized.
async function execute(rest: DiscordRest, command: DiscordCommand): Promise<unknown> {
  switch (command.operation) {
    case "get_audit_log": {
      const input = command.input;
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
      ).map((entry) => ({
        id: entry.id,
        actionType: entry.action_type,
        executor:
          typeof entry.user_id === "string"
            ? (userNames.get(entry.user_id) ?? entry.user_id)
            : null,
        targetId: entry.target_id ?? null,
        reason: entry.reason ?? null,
        changes: entry.changes,
      }));
    }
    case "list_auto_mod_rules":
      return discordArray<RESTGetAPIAutoModerationRulesResult>(
        await rest.get(Routes.guildAutoModerationRules(DISCORD_GUILD_ID)),
        "list auto moderation rules",
      ).map(summarizeAutoModRule);
    case "get_auto_mod_rule":
      return summarizeAutoModRule(
        discordObject<RESTGetAPIAutoModerationRuleResult>(
          await rest.get(Routes.guildAutoModerationRule(DISCORD_GUILD_ID, command.input.rule_id)),
          "get auto moderation rule",
        ),
      );
    case "create_auto_mod_rule": {
      const input = command.input;
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
    }
    case "update_auto_mod_rule": {
      const input = command.input;
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
    }
    case "delete_auto_mod_rule":
      await rest.delete(Routes.guildAutoModerationRule(DISCORD_GUILD_ID, command.input.rule_id));
      return { deleted: true, rule_id: command.input.rule_id };

    case "get_server_info": {
      const guild = discordObject<RESTGetAPIGuildResult>(
        await rest.get(Routes.guild(DISCORD_GUILD_ID), {
          query: makeURLSearchParams<RESTGetAPIGuildQuery>({ with_counts: true }),
        }),
        "get guild",
      );
      return {
        id: guild.id,
        name: guild.name,
        memberCount: guild.approximate_member_count,
        presenceCount: guild.approximate_presence_count,
        ownerId: guild.owner_id,
        description: guild.description ?? null,
        icon:
          typeof guild.icon === "string"
            ? `https://cdn.discordapp.com/icons/${DISCORD_GUILD_ID}/${guild.icon}.png`
            : null,
        banner:
          typeof guild.banner === "string"
            ? `https://cdn.discordapp.com/banners/${DISCORD_GUILD_ID}/${guild.banner}.png`
            : null,
        boostLevel: guild.premium_tier,
        boostCount: guild.premium_subscription_count,
        verificationLevel: guild.verification_level,
        createdAt: guild.id,
      };
    }
    case "list_channels": {
      const all = discordArray<RESTGetAPIGuildChannelsResult>(
        await rest.get(Routes.guildChannels(DISCORD_GUILD_ID)),
        "list guild channels",
      ).map((rawChannel) => discordObject<GuildChannelResult>(rawChannel, "list guild channels"));
      const channels = all.filter((entry) => !THREAD_CHANNEL_TYPES.has(entry.type));
      const categories = channels
        .filter((entry) => entry.type === ChannelType.GuildCategory)
        .sort(byPosition);
      const uncategorized = channels
        .filter((entry) => entry.type !== ChannelType.GuildCategory && !entry.parent_id)
        .sort(byPosition);
      return [
        ...categories.map((category) => ({
          category: { id: category.id, name: category.name, position: channelPosition(category) },
          channels: channels
            .filter((entry) => entry.parent_id === category.id)
            .sort(byPosition)
            .map(summarizeChannel),
        })),
        ...(uncategorized.length === 0
          ? []
          : [{ category: null, channels: uncategorized.map(summarizeChannel) }]),
      ];
    }
    case "list_roles":
      return [
        ...discordArray<RESTGetAPIGuildRolesResult>(
          await rest.get(Routes.guildRoles(DISCORD_GUILD_ID)),
          "list guild roles",
        ),
      ]
        .sort((left, right) => right.position - left.position)
        .map((role) => ({
          id: role.id,
          name: role.name,
          color: `#${Number(role.color ?? 0)
            .toString(16)
            .padStart(6, "0")}`,
          position: role.position,
          mentionable: role.mentionable,
          hoist: role.hoist,
          managed: role.managed,
          isEveryone: role.id === DISCORD_GUILD_ID,
        }));
    case "search_members": {
      const input = command.input;
      if (/^\d{17,20}$/u.test(input.query)) {
        try {
          return [
            summarizeMember(
              discordObject<RESTGetAPIGuildMemberResult>(
                await rest.get(Routes.guildMember(DISCORD_GUILD_ID, input.query)),
                "get guild member",
              ),
            ),
          ];
        } catch (cause) {
          if (httpStatusOf(cause) === 404) return [];
          throw cause;
        }
      }
      return discordArray<RESTGetAPIGuildMembersSearchResult>(
        await rest.get(Routes.guildMembersSearch(DISCORD_GUILD_ID), {
          query: makeURLSearchParams<RESTGetAPIGuildMembersSearchQuery>({
            query: input.query,
            limit: input.limit,
          }),
        }),
        "search guild members",
      ).map(summarizeMember);
    }

    case "create_channel": {
      const input = command.input;
      if (input.parent_id !== undefined) await guildChannel(rest, input.parent_id);
      return summarizeChannel(
        discordObject<GuildChannelResult>(
          await rest.post(Routes.guildChannels(DISCORD_GUILD_ID), {
            body: compact<RESTPostAPIGuildChannelJSONBody>({
              name: input.name,
              type: CHANNEL_TYPES[input.type],
              topic: input.topic,
              parent_id: input.parent_id,
              nsfw: input.nsfw,
              rate_limit_per_user: input.slowmode,
              position: input.position,
              bitrate: input.bitrate,
              user_limit: input.user_limit,
              rtc_region: input.rtc_region,
              video_quality_mode:
                input.video_quality_mode === undefined
                  ? undefined
                  : input.video_quality_mode === "full"
                    ? VideoQualityMode.Full
                    : VideoQualityMode.Auto,
              default_auto_archive_duration:
                input.default_auto_archive_duration === undefined
                  ? undefined
                  : AUTO_ARCHIVE_DURATIONS[input.default_auto_archive_duration],
              default_thread_rate_limit_per_user: input.default_thread_slowmode,
            }),
          }),
          "create guild channel",
        ),
      );
    }
    case "edit_channel": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      if (typeof input.parent_id === "string") await guildChannel(rest, input.parent_id);
      return summarizeChannel(
        discordObject<GuildChannelResult>(
          await rest.patch(Routes.channel(input.channel_id), {
            body: compact<RESTPatchAPIChannelJSONBody>({
              name: input.name,
              topic: input.topic,
              parent_id: input.parent_id,
              nsfw: input.nsfw,
              rate_limit_per_user: input.slowmode,
              position: input.position,
              bitrate: input.bitrate,
              user_limit: input.user_limit,
              rtc_region: input.rtc_region,
              video_quality_mode:
                input.video_quality_mode === undefined
                  ? undefined
                  : input.video_quality_mode === "full"
                    ? VideoQualityMode.Full
                    : VideoQualityMode.Auto,
              default_auto_archive_duration:
                input.default_auto_archive_duration === undefined
                  ? undefined
                  : AUTO_ARCHIVE_DURATIONS[input.default_auto_archive_duration],
              default_thread_rate_limit_per_user: input.default_thread_slowmode,
            }),
          }),
          "edit channel",
        ),
      );
    }
    case "get_channel":
      return summarizeChannel(await guildChannel(rest, command.input.channel_id));
    case "follow_announcement_channel": {
      const input = command.input;
      await Promise.all([
        guildChannel(rest, input.source_channel_id),
        guildChannel(rest, input.target_channel_id),
      ]);
      const followed = discordObject<RESTPostAPIChannelFollowersResult>(
        await rest.post(Routes.channelFollowers(input.source_channel_id), {
          body: {
            webhook_channel_id: input.target_channel_id,
          } satisfies RESTPostAPIChannelFollowersJSONBody,
        }),
        "follow announcement channel",
      );
      return {
        followed: true,
        source: input.source_channel_id,
        target: followed.channel_id,
        webhook_id: followed.webhook_id,
      };
    }
    case "delete_channel": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const deleted = discordObject<GuildChannelResult>(
        await rest.delete(Routes.channel(input.channel_id)),
        "delete channel",
      );
      return { success: true, deleted: deleted.name ?? input.channel_id };
    }

    case "list_emojis":
      return discordArray<RESTGetAPIGuildEmojisResult>(
        await rest.get(Routes.guildEmojis(DISCORD_GUILD_ID)),
        "list guild emojis",
      ).map(summarizeEmoji);
    case "create_emoji": {
      const input = command.input;
      const created = discordObject<RESTPostAPIGuildEmojiResult>(
        await rest.post(Routes.guildEmojis(DISCORD_GUILD_ID), {
          body: compact<RESTPostAPIGuildEmojiJSONBody>({
            name: input.name,
            image: await imageDataUri(input.url),
            roles: input.roles,
          }),
        }),
        "create guild emoji",
      );
      return summarizeEmoji(created);
    }
    case "edit_emoji": {
      const input = command.input;
      return summarizeEmoji(
        discordObject<RESTPatchAPIGuildEmojiResult>(
          await rest.patch(Routes.guildEmoji(DISCORD_GUILD_ID, input.emoji_id), {
            body: compact<RESTPatchAPIGuildEmojiJSONBody>({ name: input.name, roles: input.roles }),
          }),
          "edit guild emoji",
        ),
      );
    }
    case "delete_emoji": {
      const input = command.input;
      const emoji = discordObject<RESTGetAPIGuildEmojiResult>(
        await rest.get(Routes.guildEmoji(DISCORD_GUILD_ID, input.emoji_id)),
        "get guild emoji",
      );
      await rest.delete(Routes.guildEmoji(DISCORD_GUILD_ID, input.emoji_id));
      return { success: true, deleted: emoji.name ?? input.emoji_id };
    }

    case "list_events":
      return discordArray<RESTGetAPIGuildScheduledEventsResult>(
        await rest.get(Routes.guildScheduledEvents(DISCORD_GUILD_ID), {
          query: makeURLSearchParams<RESTGetAPIGuildScheduledEventsQuery>({
            with_user_count: true,
          }),
        }),
        "list guild scheduled events",
      ).map(summarizeEvent);
    case "create_event": {
      const input = command.input;
      if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
      const image =
        input.image === undefined ? undefined : await imageDataUri(input.image, 8 * 1_024 * 1_024);
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
    }
    case "edit_event": {
      const input = command.input;
      if (typeof input.channel_id === "string") await guildChannel(rest, input.channel_id);
      const image =
        input.image === undefined ? undefined : await imageDataUri(input.image, 8 * 1_024 * 1_024);
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
    }
    case "delete_event": {
      const input = command.input;
      const event = discordObject<RESTGetAPIGuildScheduledEventResult>(
        await rest.get(Routes.guildScheduledEvent(DISCORD_GUILD_ID, input.event_id)),
        "get guild scheduled event",
      );
      await rest.delete(Routes.guildScheduledEvent(DISCORD_GUILD_ID, input.event_id));
      return { success: true, deleted: event.name ?? input.event_id };
    }

    case "update_guild": {
      const input = command.input;
      for (const id of [input.afk_channel_id, input.system_channel_id])
        if (typeof id === "string") await guildChannel(rest, id);
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
    }
    case "get_guild_preview": {
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
    }
    case "get_vanity_url": {
      const vanity = discordObject<RESTGetAPIGuildVanityUrlResult>(
        await rest.get(Routes.guildVanityUrl(DISCORD_GUILD_ID)),
        "get guild vanity URL",
      );
      return typeof vanity.code !== "string"
        ? { configured: false }
        : {
            configured: true,
            code: vanity.code,
            url: `https://discord.gg/${vanity.code}`,
            uses: vanity.uses,
          };
    }

    case "list_invites":
      return discordArray<RESTGetAPIGuildInvitesResult>(
        await rest.get(Routes.guildInvites(DISCORD_GUILD_ID)),
        "list guild invites",
      ).map(summarizeInvite);
    case "create_invite": {
      const input = command.input;
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
      return {
        code: invite.code,
        url: typeof invite.code === "string" ? `https://discord.gg/${invite.code}` : null,
        channelId: invite.channel?.id ?? input.channel_id,
        maxAge: invite.max_age,
        maxUses: invite.max_uses,
        temporary: invite.temporary,
        expiresAt: invite.expires_at ?? null,
      };
    }
    case "delete_invite": {
      const input = command.input;
      await requireGuildInvite(rest, input.code);
      await rest.delete(Routes.invite(input.code), { reason: input.reason });
      return { success: true, deleted: input.code };
    }

    case "ban_member": {
      const input = command.input;
      await rest.put(Routes.guildBan(DISCORD_GUILD_ID, input.member_id), {
        body: {
          delete_message_seconds: input.delete_message_seconds ?? 0,
        } satisfies RESTPutAPIGuildBanJSONBody,
        reason: input.reason,
      });
      return { banned: true, member_id: input.member_id };
    }
    case "unban_member": {
      const input = command.input;
      await rest.delete(Routes.guildBan(DISCORD_GUILD_ID, input.user_id), {
        reason: input.reason,
      });
      return { unbanned: true, user_id: input.user_id };
    }
    case "list_bans": {
      const input = command.input;
      return discordArray<RESTGetAPIGuildBansResult>(
        await rest.get(Routes.guildBans(DISCORD_GUILD_ID), {
          query: makeURLSearchParams<RESTGetAPIGuildBansQuery>({
            limit: input.limit ?? 100,
            ...(input.before === undefined ? {} : { before: input.before }),
            ...(input.after === undefined ? {} : { after: input.after }),
          }),
        }),
        "list guild bans",
      ).map((ban) => {
        const user = discordObject<RESTGetAPIGuildBansResult[number]["user"]>(
          ban.user,
          "guild ban user",
        );
        return {
          userId: user.id,
          username: user.global_name ?? user.username,
          reason: ban.reason ?? null,
        };
      });
    }
    case "kick_member": {
      const input = command.input;
      await rest.delete(Routes.guildMember(DISCORD_GUILD_ID, input.member_id), {
        reason: input.reason,
      });
      return { kicked: true, member_id: input.member_id };
    }
    case "timeout_member": {
      const input = command.input;
      const timeoutUntil = new Date(Date.now() + input.duration_seconds * 1_000).toISOString();
      await rest.patch(Routes.guildMember(DISCORD_GUILD_ID, input.member_id), {
        body: {
          communication_disabled_until: timeoutUntil,
        } satisfies RESTPatchAPIGuildMemberJSONBody,
        reason: input.reason,
      });
      return { timeout_until: timeoutUntil, member_id: input.member_id };
    }
    case "clear_timeout": {
      const input = command.input;
      await rest.patch(Routes.guildMember(DISCORD_GUILD_ID, input.member_id), {
        body: {
          communication_disabled_until: null,
        } satisfies RESTPatchAPIGuildMemberJSONBody,
        reason: input.reason,
      });
      return { timeout_cleared: true, member_id: input.member_id };
    }

    case "get_member": {
      const input = command.input;
      try {
        const member = discordObject<RESTGetAPIGuildMemberResult>(
          await rest.get(Routes.guildMember(DISCORD_GUILD_ID, input.member_id)),
          "get guild member",
        );
        const user = discordObject<RESTGetAPIGuildMemberResult["user"]>(
          member.user,
          "guild member user",
        );
        return {
          ...summarizeMember(member),
          premiumSince: member.premium_since ?? null,
          avatar:
            typeof member.avatar === "string"
              ? `https://cdn.discordapp.com/guilds/${DISCORD_GUILD_ID}/users/${String(user.id)}/${member.avatar}.png`
              : typeof user.avatar === "string"
                ? `https://cdn.discordapp.com/avatars/${String(user.id)}/${user.avatar}.png`
                : null,
        };
      } catch (cause) {
        if (httpStatusOf(cause) === 404) return { error: "Member not found" };
        throw cause;
      }
    }
    case "set_nickname": {
      const input = command.input;
      await rest.patch(Routes.guildMember(DISCORD_GUILD_ID, input.member_id), {
        body: { nick: input.nickname } satisfies RESTPatchAPIGuildMemberJSONBody,
      });
      return { success: true, member: input.member_id, nickname: input.nickname };
    }

    case "add_member_to_platform": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const invite = discordObject<RESTPostAPIChannelInviteResult>(
        await rest.post(Routes.channelInvites(input.channel_id), {
          body: {
            max_age: input.max_age_seconds ?? 86_400,
            max_uses: input.max_uses ?? 1,
            temporary: false,
            unique: true,
          } satisfies RESTPostAPIChannelInviteJSONBody,
          reason: input.reason,
        }),
        "add member invite",
      );
      return {
        code: invite.code,
        url: typeof invite.code === "string" ? `https://discord.gg/${invite.code}` : null,
        maxAge: invite.max_age,
        maxUses: invite.max_uses,
        expiresAt: invite.expires_at ?? null,
      };
    }
    case "remove_member_from_platform": {
      const input = command.input;
      await rest.delete(Routes.guildMember(DISCORD_GUILD_ID, input.member_id), {
        reason: input.reason,
      });
      return { removed: true, member_id: input.member_id };
    }

    case "send_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const message = discordObject<RESTPostAPIChannelMessageResult>(
        await rest.post(Routes.channelMessages(input.channel_id), {
          body: { content: input.content } satisfies RESTPostAPIChannelMessageJSONBody,
        }),
        "send channel message",
      );
      return { id: message.id, channelId: message.channel_id, content: message.content };
    }
    case "delete_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      await rest.delete(Routes.channelMessage(input.channel_id, input.message_id));
      return { success: true, deleted: input.message_id };
    }
    case "pin_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      await rest.put(Routes.channelPin(input.channel_id, input.message_id));
      return { success: true, pinned: input.message_id };
    }
    case "unpin_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      await rest.delete(Routes.channelPin(input.channel_id, input.message_id));
      return { success: true, unpinned: input.message_id };
    }
    case "add_reaction": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      await rest.put(
        Routes.channelMessageOwnReaction(
          input.channel_id,
          input.message_id,
          encodeURIComponent(input.emoji),
        ),
      );
      return { success: true, reacted: input.emoji };
    }
    case "get_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      return summarizeMessage(
        discordObject<RESTGetAPIChannelMessageResult>(
          await rest.get(Routes.channelMessage(input.channel_id, input.message_id)),
          "get channel message",
        ),
      );
    }
    case "edit_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const message = discordObject<RESTPatchAPIChannelMessageResult>(
        await rest.patch(Routes.channelMessage(input.channel_id, input.message_id), {
          body: { content: input.content } satisfies RESTPatchAPIChannelMessageJSONBody,
        }),
        "edit channel message",
      );
      return { id: message.id, content: message.content };
    }
    case "bulk_delete_messages": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      await rest.post(Routes.channelBulkDelete(input.channel_id), {
        body: {
          messages: input.message_ids,
        } satisfies RESTPostAPIChannelMessagesBulkDeleteJSONBody,
      });
      return { deleted: input.message_ids.length, message_ids: input.message_ids };
    }
    case "crosspost_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const message = discordObject<RESTPostAPIChannelMessageCrosspostResult>(
        await rest.post(Routes.channelMessageCrosspost(input.channel_id, input.message_id)),
        "crosspost channel message",
      );
      return { id: message.id, crossposted: true };
    }
    case "remove_reaction": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const emoji = encodeURIComponent(input.emoji);
      const route =
        input.user_id === "@me"
          ? Routes.channelMessageOwnReaction(input.channel_id, input.message_id, emoji)
          : Routes.channelMessageUserReaction(
              input.channel_id,
              input.message_id,
              emoji,
              input.user_id,
            );
      await rest.delete(route);
      return { removed: true };
    }
    case "remove_all_reactions": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      await rest.delete(Routes.channelMessageAllReactions(input.channel_id, input.message_id));
      return { cleared: true };
    }
    case "fetch_messages": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const fetchedMessages = discordArray<RESTGetAPIChannelMessagesResult>(
        await rest.get(Routes.channelMessages(input.channel_id), {
          query: makeURLSearchParams<RESTGetAPIChannelMessagesQuery>({
            limit: input.limit,
            ...(input.before === undefined ? {} : { before: input.before }),
            ...(input.after === undefined ? {} : { after: input.after }),
          }),
        }),
        "fetch channel messages",
      );
      return [...fetchedMessages]
        .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
        .map(summarizeMessage);
    }

    case "create_role": {
      const input = command.input;
      const icon = input.icon === undefined ? undefined : await imageDataUri(input.icon);
      const role = discordObject<RESTPostAPIGuildRoleResult>(
        await rest.post(Routes.guildRoles(DISCORD_GUILD_ID), {
          body: compact<RESTPostAPIGuildRoleJSONBody>({
            name: input.name,
            color:
              input.color === undefined ? undefined : Number.parseInt(input.color.slice(1), 16),
            hoist: input.hoist,
            mentionable: input.mentionable,
            icon,
            unicode_emoji: input.unicode_emoji,
          }),
        }),
        "create guild role",
      );
      if (input.position !== undefined)
        await rest.patch(Routes.guildRoles(DISCORD_GUILD_ID), {
          body: [
            { id: role.id, position: input.position },
          ] satisfies RESTPatchAPIGuildRolePositionsJSONBody,
        });
      return summarizeRole(role);
    }
    case "edit_role": {
      const input = command.input;
      const icon = typeof input.icon === "string" ? await imageDataUri(input.icon) : input.icon;
      const role = discordObject<RESTPatchAPIGuildRoleResult>(
        await rest.patch(Routes.guildRole(DISCORD_GUILD_ID, input.role_id), {
          body: compact<RESTPatchAPIGuildRoleJSONBody>({
            name: input.name,
            color:
              input.color === undefined ? undefined : Number.parseInt(input.color.slice(1), 16),
            hoist: input.hoist,
            mentionable: input.mentionable,
            icon,
            unicode_emoji: input.unicode_emoji,
          }),
        }),
        "edit guild role",
      );
      if (input.position !== undefined)
        await rest.patch(Routes.guildRoles(DISCORD_GUILD_ID), {
          body: [
            { id: input.role_id, position: input.position },
          ] satisfies RESTPatchAPIGuildRolePositionsJSONBody,
        });
      return summarizeRole(role);
    }
    case "delete_role": {
      const input = command.input;
      const guildRoles = discordArray<RESTGetAPIGuildRolesResult>(
        await rest.get(Routes.guildRoles(DISCORD_GUILD_ID)),
        "list guild roles",
      );
      const targetRole = guildRoles.find((entry) => entry.id === input.role_id);
      if (targetRole === undefined) return { error: "Role not found" };
      await rest.delete(Routes.guildRole(DISCORD_GUILD_ID, input.role_id));
      return { success: true, deleted: targetRole.name };
    }
    case "assign_role": {
      const input = command.input;
      await rest.put(Routes.guildMemberRole(DISCORD_GUILD_ID, input.member_id, input.role_id));
      return { success: true, member: input.member_id, role: input.role_id };
    }
    case "remove_role": {
      const input = command.input;
      await rest.delete(Routes.guildMemberRole(DISCORD_GUILD_ID, input.member_id, input.role_id));
      return { success: true, member: input.member_id, role: input.role_id };
    }

    case "list_stickers":
      return discordArray<RESTGetAPIGuildStickersResult>(
        await rest.get(Routes.guildStickers(DISCORD_GUILD_ID)),
        "list guild stickers",
      ).map(summarizeSticker);
    case "create_sticker": {
      const input = command.input;
      const file = await download(input.url, 512 * 1_024, [
        "image/png",
        "image/apng",
        "application/json",
      ]);
      const sticker = discordObject<RESTPostAPIGuildStickerResult>(
        await rest.post(Routes.guildStickers(DISCORD_GUILD_ID), {
          body: compact<
            Pick<RESTPostAPIGuildStickerFormDataBody, "name" | "tags"> &
              Partial<Pick<RESTPostAPIGuildStickerFormDataBody, "description">>
          >({
            name: input.name,
            ...(input.description === undefined ? {} : { description: input.description }),
            tags: input.tags,
          }),
          files: [
            {
              data: file.bytes,
              name: file.contentType === "application/json" ? "sticker.json" : "sticker.png",
              contentType: file.contentType,
            },
          ],
        }),
        "create guild sticker",
      );
      return summarizeSticker(sticker);
    }
    case "edit_sticker": {
      const input = command.input;
      return summarizeSticker(
        discordObject<RESTPatchAPIGuildStickerResult>(
          await rest.patch(Routes.guildSticker(DISCORD_GUILD_ID, input.sticker_id), {
            body: compact<RESTPatchAPIGuildStickerJSONBody>({
              name: input.name,
              description: input.description,
              tags: input.tags,
            }),
          }),
          "edit guild sticker",
        ),
      );
    }
    case "delete_sticker":
      await rest.delete(Routes.guildSticker(DISCORD_GUILD_ID, command.input.sticker_id));
      return { deleted: true, sticker_id: command.input.sticker_id };

    case "list_threads": {
      const input = command.input;
      const active = discordObject<RESTGetAPIGuildThreadsResult>(
        await rest.get(Routes.guildActiveThreads(DISCORD_GUILD_ID)),
        "list active guild threads",
      );
      let foundThreads = discordArray<RESTGetAPIGuildThreadsResult["threads"]>(
        active.threads,
        "list active guild threads",
      )
        .map((thread) => discordObject<ThreadResult>(thread, "list active guild threads"))
        .filter((thread) => input.channel_id === undefined || thread.parent_id === input.channel_id)
        .map(summarizeThread);
      if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
      if (input.channel_id !== undefined && input.include_archived) {
        const archived = discordObject<RESTGetAPIChannelThreadsArchivedPublicResult>(
          await rest.get(Routes.channelThreads(input.channel_id, "public")),
          "list archived channel threads",
        );
        foundThreads = [
          ...foundThreads,
          ...discordArray<RESTGetAPIChannelThreadsArchivedPublicResult["threads"]>(
            archived.threads,
            "list archived channel threads",
          )
            .map((thread) => discordObject<ThreadResult>(thread, "list archived channel threads"))
            .map(summarizeThread),
        ];
      }
      return foundThreads;
    }
    case "create_thread": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const body = compact<
        RESTPostAPIChannelThreadsJSONBody | RESTPostAPIChannelMessagesThreadsJSONBody
      >({
        name: input.name,
        auto_archive_duration:
          input.auto_archive_duration === undefined
            ? undefined
            : AUTO_ARCHIVE_DURATIONS[input.auto_archive_duration],
        rate_limit_per_user: input.slowmode,
        type:
          input.message_id === undefined
            ? input.type === "private"
              ? ChannelType.PrivateThread
              : ChannelType.PublicThread
            : undefined,
        invitable:
          input.message_id === undefined && input.type === "private" ? input.invitable : undefined,
      });
      const path = Routes.threads(input.channel_id, input.message_id);
      return summarizeThread(
        discordObject<ThreadResult>(await rest.post(path, { body }), "create channel thread"),
      );
    }
    case "edit_thread": {
      const input = command.input;
      await guildChannel(rest, input.thread_id);
      return summarizeThread(
        discordObject<ThreadResult>(
          await rest.patch(Routes.channel(input.thread_id), {
            body: compact<RESTPatchAPIChannelJSONBody>({
              name: input.name,
              archived: input.archived,
              locked: input.locked,
              auto_archive_duration:
                input.auto_archive_duration === undefined
                  ? undefined
                  : AUTO_ARCHIVE_DURATIONS[input.auto_archive_duration],
              rate_limit_per_user: input.slowmode,
              invitable: input.invitable,
            }),
          }),
          "edit channel thread",
        ),
      );
    }
    case "delete_thread": {
      const input = command.input;
      await guildChannel(rest, input.thread_id);
      const thread = discordObject<ThreadResult>(
        await rest.delete(Routes.channel(input.thread_id)),
        "delete thread",
      );
      return { success: true, deleted: thread.name ?? input.thread_id };
    }

    case "list_webhooks": {
      const input = command.input;
      if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
      const path =
        input.channel_id === undefined
          ? Routes.guildWebhooks(DISCORD_GUILD_ID)
          : Routes.channelWebhooks(input.channel_id);
      return discordArray<RESTGetAPIGuildWebhooksResult | RESTGetAPIChannelWebhooksResult>(
        await rest.get(path),
        "list webhooks",
      ).map(summarizeWebhook);
    }
    case "create_webhook": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const avatar = input.avatar === undefined ? undefined : await imageDataUri(input.avatar);
      return summarizeWebhook(
        discordObject<RESTPostAPIChannelWebhookResult>(
          await rest.post(Routes.channelWebhooks(input.channel_id), {
            body: compact<RESTPostAPIChannelWebhookJSONBody>({ name: input.name, avatar }),
          }),
          "create channel webhook",
        ),
      );
    }
    case "edit_webhook": {
      const input = command.input;
      await guildWebhook(rest, input.webhook_id);
      if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
      const avatar = input.avatar === undefined ? undefined : await imageDataUri(input.avatar);
      return summarizeWebhook(
        discordObject<RESTPatchAPIWebhookResult>(
          await rest.patch(Routes.webhook(input.webhook_id), {
            body: compact<RESTPatchAPIWebhookJSONBody>({
              name: input.name,
              avatar,
              channel_id: input.channel_id,
            }),
          }),
          "edit webhook",
        ),
      );
    }
    case "delete_webhook": {
      const input = command.input;
      const webhook = await guildWebhook(rest, input.webhook_id);
      await rest.delete(Routes.webhook(input.webhook_id));
      return { success: true, deleted: webhook.name ?? input.webhook_id };
    }
  }
  command satisfies never;
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
function summarizeMessage(message: RESTGetAPIChannelMessageResult) {
  const author = discordObject<RESTGetAPIChannelMessageResult["author"]>(
    message.author,
    "message author",
  );
  return {
    id: message.id,
    author: author.global_name ?? author.username,
    authorId: author.id,
    isBot: author.bot ?? false,
    content: message.content,
    timestamp: message.timestamp,
    editedTimestamp: message.edited_timestamp ?? null,
    pinned: message.pinned,
    attachments: discordArray<RESTGetAPIChannelMessageResult["attachments"]>(
      message.attachments,
      "message attachments",
    ).map((attachment) => ({
      name: attachment.filename,
      url: attachment.url,
    })),
    embeds: message.embeds.length,
  };
}
function summarizeRole(role: RESTGetAPIGuildRolesResult[number]) {
  return {
    id: role.id,
    name: role.name,
    color: `#${Number(role.color ?? 0)
      .toString(16)
      .padStart(6, "0")}`,
    position: role.position,
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
function channelPosition(channel: GuildChannelResult): number {
  if (!("position" in channel) || typeof channel.position !== "number") {
    throw malformedDiscordResponse("list guild channels");
  }
  return channel.position;
}
function byPosition(left: GuildChannelResult, right: GuildChannelResult): number {
  return channelPosition(left) - channelPosition(right);
}

/** Result remains inside the bot; the HTTP route serializes only a safe projection. */
export function executeDiscordCommand(
  rest: DiscordRest,
  command: DiscordCommand,
): Promise<Result<DiscordCommandOutput<DiscordCommandOperation>, DiscordCommandError>> {
  return Result.tryPromise({
    try: async () => {
      const output = decodeDiscordCommandOutput(command.operation, await execute(rest, command));
      if (Result.isError(output)) {
        throw new UpstreamError({ service: "discord", status: 502, detail: output.error.message });
      }
      return output.value;
    },
    catch: discordError(`execute Discord ${command.operation}`),
  });
}
