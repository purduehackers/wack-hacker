/** Bot-owned executor for the strict semantic Discord command RPC. */
/* oxlint-disable unicorn/no-null -- Discord's JSON API uses null for explicit absence/field clearing. */

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import type { DiscordCommand } from "@repo/shared/discord-command-wire";
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
  StickerFormatType,
  ThreadAutoArchiveDuration,
  VideoQualityMode,
  type Client,
} from "discord.js";
import { z } from "zod";

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
const IMAGE_TIMEOUT_MS = 15_000;

type DiscordRest = Pick<Client["rest"], "delete" | "get" | "patch" | "post" | "put">;
type DiscordCommandError = RateLimited | Transient | UpstreamError;

const unknownRecordSchema = z.looseObject({});
function record(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = unknownRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function compact(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
function channelType(value: unknown): string {
  return typeof value === "number" ? (CHANNEL_TYPE_NAMES[value] ?? `unknown(${value})`) : "unknown";
}
function summarizeChannel(value: unknown) {
  const channel = record(value);
  return compact({
    id: channel.id,
    name: channel.name,
    type: channelType(channel.type),
    topic: channel.topic ?? undefined,
    parentId: channel.parent_id ?? undefined,
    position: channel.position,
  });
}
function summarizeMember(value: unknown) {
  const member = record(value);
  const user = record(member.user);
  return {
    id: user.id,
    username: user.username,
    displayName: user.global_name ?? user.username,
    nickname: member.nick ?? null,
    roles: Array.isArray(member.roles) ? member.roles : [],
    joinedAt: member.joined_at ?? null,
    isBot: user.bot ?? false,
  };
}
function summarizeEvent(value: unknown) {
  const event = record(value);
  const metadata = record(event.entity_metadata);
  return {
    id: event.id,
    name: event.name,
    description: event.description ?? null,
    scheduledStartAt: event.scheduled_start_time ?? null,
    scheduledEndAt: event.scheduled_end_time ?? null,
    status: event.status,
    entityType: event.entity_type,
    channelId: event.channel_id ?? null,
    location: metadata.location ?? null,
    userCount: event.user_count ?? null,
    creatorId: event.creator_id ?? null,
    image:
      typeof event.id === "string" && typeof event.image === "string"
        ? `https://cdn.discordapp.com/guild-events/${event.id}/${event.image}.png`
        : null,
  };
}
function summarizeThread(value: unknown) {
  const thread = record(value);
  const metadata = record(thread.thread_metadata);
  return {
    id: thread.id,
    name: thread.name,
    parentId: thread.parent_id ?? null,
    archived: metadata.archived ?? false,
    locked: metadata.locked ?? false,
    autoArchiveDuration: metadata.auto_archive_duration ?? null,
    messageCount: thread.message_count ?? 0,
    memberCount: thread.member_count ?? 0,
    createdAt: metadata.create_timestamp ?? null,
    type: channelType(thread.type),
  };
}
function summarizeEmoji(value: unknown) {
  const emoji = record(value);
  const animated = Boolean(emoji.animated);
  return {
    id: emoji.id,
    name: emoji.name,
    animated,
    url:
      typeof emoji.id === "string"
        ? `https://cdn.discordapp.com/emojis/${emoji.id}.${animated ? "gif" : "png"}`
        : null,
    roles: Array.isArray(emoji.roles) ? emoji.roles : [],
    createdAt: emoji.id,
  };
}
function summarizeSticker(value: unknown) {
  const sticker = record(value);
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
function summarizeWebhook(value: unknown) {
  const webhook = record(value);
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

async function guildChannel(
  rest: DiscordRest,
  id: string,
): Promise<Readonly<Record<string, unknown>>> {
  const channel = record(await rest.get(`/channels/${id}`));
  if (channel.guild_id !== DISCORD_GUILD_ID) {
    throw new UpstreamError({
      service: "discord",
      status: 403,
      detail: "channel is outside the managed guild",
    });
  }
  return channel;
}
async function guildWebhook(
  rest: DiscordRest,
  id: string,
): Promise<Readonly<Record<string, unknown>>> {
  const webhook = record(await rest.get(`/webhooks/${id}`));
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
  const invite = record(await rest.get(`/invites/${encodeURIComponent(code)}`));
  if (record(invite.guild).id !== DISCORD_GUILD_ID) {
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

function query(values: Readonly<Record<string, string | number | undefined>>): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) result.set(key, String(value));
  return result;
}

// oxlint-disable-next-line oxclippy/too-many-lines, oxclippy/cognitive-complexity -- exhaustive 68-operation allowlist is intentionally centralized.
async function execute(rest: DiscordRest, command: DiscordCommand): Promise<unknown> {
  switch (command.operation) {
    case "get_audit_log": {
      const input = command.input;
      const raw = record(
        await rest.get(`/guilds/${DISCORD_GUILD_ID}/audit-logs`, {
          query: query({
            limit: input.limit ?? 50,
            user_id: input.user_id,
            action_type: input.action_type,
            before: input.before,
            after: input.after,
          }),
        }),
      );
      const userNames = new Map(
        records(raw.users).map((user) => [user.id, user.global_name ?? user.username]),
      );
      return records(raw.audit_log_entries).map((entry) => ({
        id: entry.id,
        actionType: entry.action_type,
        executor:
          typeof entry.user_id === "string"
            ? (userNames.get(entry.user_id) ?? entry.user_id)
            : null,
        targetId: entry.target_id ?? null,
        reason: entry.reason ?? null,
        changes: Array.isArray(entry.changes) ? entry.changes : undefined,
      }));
    }
    case "list_auto_mod_rules":
      return records(await rest.get(`/guilds/${DISCORD_GUILD_ID}/auto-moderation/rules`)).map(
        summarizeAutoModRule,
      );
    case "get_auto_mod_rule":
      return summarizeAutoModRule(
        await rest.get(
          `/guilds/${DISCORD_GUILD_ID}/auto-moderation/rules/${command.input.rule_id}`,
        ),
      );
    case "create_auto_mod_rule": {
      const input = command.input;
      return summarizeAutoModRule(
        await rest.post(`/guilds/${DISCORD_GUILD_ID}/auto-moderation/rules`, {
          body: compact({
            name: input.name,
            event_type: AUTO_MOD_EVENT_TYPES[input.event_type],
            trigger_type: AUTO_MOD_TRIGGER_TYPES[input.trigger_type],
            trigger_metadata: input.trigger_metadata,
            actions: input.actions.map((action) => ({
              ...action,
              type: AUTO_MOD_ACTION_TYPES[action.type],
            })),
            enabled: input.enabled,
            exempt_roles: input.exempt_roles,
            exempt_channels: input.exempt_channels,
          }),
        }),
      );
    }
    case "update_auto_mod_rule": {
      const input = command.input;
      return summarizeAutoModRule(
        await rest.patch(`/guilds/${DISCORD_GUILD_ID}/auto-moderation/rules/${input.rule_id}`, {
          body: compact({
            name: input.name,
            event_type:
              input.event_type === undefined ? undefined : AUTO_MOD_EVENT_TYPES[input.event_type],
            trigger_metadata: input.trigger_metadata,
            actions: input.actions?.map((action) => ({
              ...action,
              type: AUTO_MOD_ACTION_TYPES[action.type],
            })),
            enabled: input.enabled,
            exempt_roles: input.exempt_roles,
            exempt_channels: input.exempt_channels,
          }),
        }),
      );
    }
    case "delete_auto_mod_rule":
      await rest.delete(
        `/guilds/${DISCORD_GUILD_ID}/auto-moderation/rules/${command.input.rule_id}`,
      );
      return { deleted: true, rule_id: command.input.rule_id };

    case "get_server_info": {
      const guild = record(
        await rest.get(`/guilds/${DISCORD_GUILD_ID}`, { query: query({ with_counts: "true" }) }),
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
      const all = records(await rest.get(`/guilds/${DISCORD_GUILD_ID}/channels`));
      const channels = all.filter((entry) => !THREAD_CHANNEL_TYPES.has(Number(entry.type)));
      const categories = channels
        .filter((entry) => entry.type === ChannelType.GuildCategory)
        .sort(byPosition);
      const uncategorized = channels
        .filter((entry) => entry.type !== ChannelType.GuildCategory && !entry.parent_id)
        .sort(byPosition);
      return [
        ...categories.map((category) => ({
          category: { id: category.id, name: category.name, position: category.position },
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
      return [...records(await rest.get(`/guilds/${DISCORD_GUILD_ID}/roles`))]
        .sort((left, right) => Number(right.position) - Number(left.position))
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
            summarizeMember(await rest.get(`/guilds/${DISCORD_GUILD_ID}/members/${input.query}`)),
          ];
        } catch (cause) {
          if (httpStatusOf(cause) === 404) return [];
          throw cause;
        }
      }
      return records(
        await rest.get(`/guilds/${DISCORD_GUILD_ID}/members/search`, {
          query: query({ query: input.query, limit: input.limit }),
        }),
      ).map(summarizeMember);
    }

    case "create_channel": {
      const input = command.input;
      if (input.parent_id !== undefined) await guildChannel(rest, input.parent_id);
      return summarizeChannel(
        await rest.post(`/guilds/${DISCORD_GUILD_ID}/channels`, {
          body: compact({
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
      );
    }
    case "edit_channel": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      if (typeof input.parent_id === "string") await guildChannel(rest, input.parent_id);
      return summarizeChannel(
        await rest.patch(`/channels/${input.channel_id}`, {
          body: compact({
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
      const followed = record(
        await rest.post(`/channels/${input.source_channel_id}/followers`, {
          body: { webhook_channel_id: input.target_channel_id },
        }),
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
      const deleted = record(await rest.delete(`/channels/${input.channel_id}`));
      return { success: true, deleted: deleted.name ?? input.channel_id };
    }

    case "list_emojis":
      return records(await rest.get(`/guilds/${DISCORD_GUILD_ID}/emojis`)).map(summarizeEmoji);
    case "create_emoji": {
      const input = command.input;
      const created = await rest.post(`/guilds/${DISCORD_GUILD_ID}/emojis`, {
        body: compact({
          name: input.name,
          image: await imageDataUri(input.url),
          roles: input.roles,
        }),
      });
      return summarizeEmoji(created);
    }
    case "edit_emoji": {
      const input = command.input;
      return summarizeEmoji(
        await rest.patch(`/guilds/${DISCORD_GUILD_ID}/emojis/${input.emoji_id}`, {
          body: compact({ name: input.name, roles: input.roles }),
        }),
      );
    }
    case "delete_emoji": {
      const input = command.input;
      const emoji = record(await rest.get(`/guilds/${DISCORD_GUILD_ID}/emojis/${input.emoji_id}`));
      await rest.delete(`/guilds/${DISCORD_GUILD_ID}/emojis/${input.emoji_id}`);
      return { success: true, deleted: emoji.name ?? input.emoji_id };
    }

    case "list_events":
      return records(
        await rest.get(`/guilds/${DISCORD_GUILD_ID}/scheduled-events`, {
          query: query({ with_user_count: "true" }),
        }),
      ).map(summarizeEvent);
    case "create_event": {
      const input = command.input;
      if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
      const image =
        input.image === undefined ? undefined : await imageDataUri(input.image, 8 * 1_024 * 1_024);
      return summarizeEvent(
        await rest.post(`/guilds/${DISCORD_GUILD_ID}/scheduled-events`, {
          body: compact({
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
      );
    }
    case "edit_event": {
      const input = command.input;
      if (typeof input.channel_id === "string") await guildChannel(rest, input.channel_id);
      const image =
        input.image === undefined ? undefined : await imageDataUri(input.image, 8 * 1_024 * 1_024);
      return summarizeEvent(
        await rest.patch(`/guilds/${DISCORD_GUILD_ID}/scheduled-events/${input.event_id}`, {
          body: compact({
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
      );
    }
    case "delete_event": {
      const input = command.input;
      const event = record(
        await rest.get(`/guilds/${DISCORD_GUILD_ID}/scheduled-events/${input.event_id}`),
      );
      await rest.delete(`/guilds/${DISCORD_GUILD_ID}/scheduled-events/${input.event_id}`);
      return { success: true, deleted: event.name ?? input.event_id };
    }

    case "update_guild": {
      const input = command.input;
      for (const id of [input.afk_channel_id, input.system_channel_id])
        if (typeof id === "string") await guildChannel(rest, id);
      const guild = record(
        await rest.patch(`/guilds/${DISCORD_GUILD_ID}`, {
          body: compact({
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
      );
      return { id: guild.id, name: guild.name, description: guild.description ?? null };
    }
    case "get_guild_preview": {
      const preview = record(await rest.get(`/guilds/${DISCORD_GUILD_ID}/preview`));
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
      const vanity = record(await rest.get(`/guilds/${DISCORD_GUILD_ID}/vanity-url`));
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
      return records(await rest.get(`/guilds/${DISCORD_GUILD_ID}/invites`)).map(summarizeInvite);
    case "create_invite": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const invite = record(
        await rest.post(`/channels/${input.channel_id}/invites`, {
          body: compact({
            max_age: input.max_age,
            max_uses: input.max_uses,
            temporary: input.temporary,
            unique: input.unique,
          }),
          reason: input.reason,
        }),
      );
      return {
        code: invite.code,
        url: typeof invite.code === "string" ? `https://discord.gg/${invite.code}` : null,
        channelId: record(invite.channel).id ?? input.channel_id,
        maxAge: invite.max_age,
        maxUses: invite.max_uses,
        temporary: invite.temporary,
        expiresAt: invite.expires_at ?? null,
      };
    }
    case "delete_invite": {
      const input = command.input;
      await requireGuildInvite(rest, input.code);
      await rest.delete(`/invites/${encodeURIComponent(input.code)}`, { reason: input.reason });
      return { success: true, deleted: input.code };
    }

    case "ban_member": {
      const input = command.input;
      await rest.put(`/guilds/${DISCORD_GUILD_ID}/bans/${input.member_id}`, {
        body: { delete_message_seconds: input.delete_message_seconds ?? 0 },
        reason: input.reason,
      });
      return { banned: true, member_id: input.member_id };
    }
    case "unban_member": {
      const input = command.input;
      await rest.delete(`/guilds/${DISCORD_GUILD_ID}/bans/${input.user_id}`, {
        reason: input.reason,
      });
      return { unbanned: true, user_id: input.user_id };
    }
    case "list_bans": {
      const input = command.input;
      return records(
        await rest.get(`/guilds/${DISCORD_GUILD_ID}/bans`, {
          query: query({ limit: input.limit ?? 100, before: input.before, after: input.after }),
        }),
      ).map((ban) => {
        const user = record(ban.user);
        return {
          userId: user.id,
          username: user.global_name ?? user.username,
          reason: ban.reason ?? null,
        };
      });
    }
    case "kick_member": {
      const input = command.input;
      await rest.delete(`/guilds/${DISCORD_GUILD_ID}/members/${input.member_id}`, {
        reason: input.reason,
      });
      return { kicked: true, member_id: input.member_id };
    }
    case "timeout_member": {
      const input = command.input;
      const timeoutUntil = new Date(Date.now() + input.duration_seconds * 1_000).toISOString();
      await rest.patch(`/guilds/${DISCORD_GUILD_ID}/members/${input.member_id}`, {
        body: { communication_disabled_until: timeoutUntil },
        reason: input.reason,
      });
      return { timeout_until: timeoutUntil, member_id: input.member_id };
    }
    case "clear_timeout": {
      const input = command.input;
      await rest.patch(`/guilds/${DISCORD_GUILD_ID}/members/${input.member_id}`, {
        body: { communication_disabled_until: null },
        reason: input.reason,
      });
      return { timeout_cleared: true, member_id: input.member_id };
    }

    case "get_member": {
      const input = command.input;
      try {
        const member = record(
          await rest.get(`/guilds/${DISCORD_GUILD_ID}/members/${input.member_id}`),
        );
        const user = record(member.user);
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
      await rest.patch(`/guilds/${DISCORD_GUILD_ID}/members/${input.member_id}`, {
        body: { nick: input.nickname },
      });
      return { success: true, member: input.member_id, nickname: input.nickname };
    }

    case "add_member_to_platform": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const invite = record(
        await rest.post(`/channels/${input.channel_id}/invites`, {
          body: {
            max_age: input.max_age_seconds ?? 86_400,
            max_uses: input.max_uses ?? 1,
            temporary: false,
            unique: true,
          },
          reason: input.reason,
        }),
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
      await rest.delete(`/guilds/${DISCORD_GUILD_ID}/members/${input.member_id}`, {
        reason: input.reason,
      });
      return { removed: true, member_id: input.member_id };
    }

    case "send_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const message = record(
        await rest.post(`/channels/${input.channel_id}/messages`, {
          body: { content: input.content },
        }),
      );
      return { id: message.id, channelId: message.channel_id, content: message.content };
    }
    case "delete_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      await rest.delete(`/channels/${input.channel_id}/messages/${input.message_id}`);
      return { success: true, deleted: input.message_id };
    }
    case "pin_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      await rest.put(`/channels/${input.channel_id}/pins/${input.message_id}`);
      return { success: true, pinned: input.message_id };
    }
    case "unpin_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      await rest.delete(`/channels/${input.channel_id}/pins/${input.message_id}`);
      return { success: true, unpinned: input.message_id };
    }
    case "add_reaction": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      await rest.put(
        `/channels/${input.channel_id}/messages/${input.message_id}/reactions/${encodeURIComponent(input.emoji)}/@me`,
      );
      return { success: true, reacted: input.emoji };
    }
    case "get_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      return summarizeMessage(
        await rest.get(`/channels/${input.channel_id}/messages/${input.message_id}`),
      );
    }
    case "edit_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const message = record(
        await rest.patch(`/channels/${input.channel_id}/messages/${input.message_id}`, {
          body: { content: input.content },
        }),
      );
      return { id: message.id, content: message.content };
    }
    case "bulk_delete_messages": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      await rest.post(`/channels/${input.channel_id}/messages/bulk-delete`, {
        body: { messages: input.message_ids },
      });
      return { deleted: input.message_ids.length, message_ids: input.message_ids };
    }
    case "crosspost_message": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const message = record(
        await rest.post(`/channels/${input.channel_id}/messages/${input.message_id}/crosspost`),
      );
      return { id: message.id, crossposted: true };
    }
    case "remove_reaction": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const user = input.user_id === "@me" ? "@me" : input.user_id;
      await rest.delete(
        `/channels/${input.channel_id}/messages/${input.message_id}/reactions/${encodeURIComponent(input.emoji)}/${user}`,
      );
      return { removed: true };
    }
    case "remove_all_reactions": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      await rest.delete(`/channels/${input.channel_id}/messages/${input.message_id}/reactions`);
      return { cleared: true };
    }
    case "fetch_messages": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const fetchedMessages = records(
        await rest.get(`/channels/${input.channel_id}/messages`, {
          query: query({ limit: input.limit, before: input.before, after: input.after }),
        }),
      );
      return [...fetchedMessages]
        .sort(
          (left, right) => Date.parse(String(left.timestamp)) - Date.parse(String(right.timestamp)),
        )
        .map(summarizeMessage);
    }

    case "create_role": {
      const input = command.input;
      const icon = input.icon === undefined ? undefined : await imageDataUri(input.icon);
      const role = record(
        await rest.post(`/guilds/${DISCORD_GUILD_ID}/roles`, {
          body: compact({
            name: input.name,
            color:
              input.color === undefined ? undefined : Number.parseInt(input.color.slice(1), 16),
            hoist: input.hoist,
            mentionable: input.mentionable,
            icon,
            unicode_emoji: input.unicode_emoji,
          }),
        }),
      );
      if (input.position !== undefined)
        await rest.patch(`/guilds/${DISCORD_GUILD_ID}/roles`, {
          body: [{ id: role.id, position: input.position }],
        });
      return summarizeRole(role);
    }
    case "edit_role": {
      const input = command.input;
      const icon = typeof input.icon === "string" ? await imageDataUri(input.icon) : input.icon;
      const role = record(
        await rest.patch(`/guilds/${DISCORD_GUILD_ID}/roles/${input.role_id}`, {
          body: compact({
            name: input.name,
            color:
              input.color === undefined ? undefined : Number.parseInt(input.color.slice(1), 16),
            hoist: input.hoist,
            mentionable: input.mentionable,
            icon,
            unicode_emoji: input.unicode_emoji,
          }),
        }),
      );
      if (input.position !== undefined)
        await rest.patch(`/guilds/${DISCORD_GUILD_ID}/roles`, {
          body: [{ id: input.role_id, position: input.position }],
        });
      return summarizeRole(role);
    }
    case "delete_role": {
      const input = command.input;
      const guildRoles = records(await rest.get(`/guilds/${DISCORD_GUILD_ID}/roles`));
      const targetRole = guildRoles.find((entry) => entry.id === input.role_id);
      if (targetRole === undefined) return { error: "Role not found" };
      await rest.delete(`/guilds/${DISCORD_GUILD_ID}/roles/${input.role_id}`);
      return { success: true, deleted: targetRole.name };
    }
    case "assign_role": {
      const input = command.input;
      await rest.put(
        `/guilds/${DISCORD_GUILD_ID}/members/${input.member_id}/roles/${input.role_id}`,
      );
      return { success: true, member: input.member_id, role: input.role_id };
    }
    case "remove_role": {
      const input = command.input;
      await rest.delete(
        `/guilds/${DISCORD_GUILD_ID}/members/${input.member_id}/roles/${input.role_id}`,
      );
      return { success: true, member: input.member_id, role: input.role_id };
    }

    case "list_stickers":
      return records(await rest.get(`/guilds/${DISCORD_GUILD_ID}/stickers`)).map(summarizeSticker);
    case "create_sticker": {
      const input = command.input;
      const file = await download(input.url, 512 * 1_024, [
        "image/png",
        "image/apng",
        "application/json",
      ]);
      const sticker = await rest.post(`/guilds/${DISCORD_GUILD_ID}/stickers`, {
        body: compact({ name: input.name, description: input.description, tags: input.tags }),
        files: [
          {
            data: file.bytes,
            name: file.contentType === "application/json" ? "sticker.json" : "sticker.png",
            contentType: file.contentType,
          },
        ],
      });
      return summarizeSticker(sticker);
    }
    case "edit_sticker": {
      const input = command.input;
      return summarizeSticker(
        await rest.patch(`/guilds/${DISCORD_GUILD_ID}/stickers/${input.sticker_id}`, {
          body: compact({ name: input.name, description: input.description, tags: input.tags }),
        }),
      );
    }
    case "delete_sticker":
      await rest.delete(`/guilds/${DISCORD_GUILD_ID}/stickers/${command.input.sticker_id}`);
      return { deleted: true, sticker_id: command.input.sticker_id };

    case "list_threads": {
      const input = command.input;
      const active = record(await rest.get(`/guilds/${DISCORD_GUILD_ID}/threads/active`));
      let foundThreads = records(active.threads)
        .filter((thread) => input.channel_id === undefined || thread.parent_id === input.channel_id)
        .map(summarizeThread);
      if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
      if (input.channel_id !== undefined && input.include_archived) {
        const archived = record(
          await rest.get(`/channels/${input.channel_id}/threads/archived/public`),
        );
        foundThreads = [...foundThreads, ...records(archived.threads).map(summarizeThread)];
      }
      return foundThreads;
    }
    case "create_thread": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const body = compact({
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
      const path: Parameters<DiscordRest["post"]>[0] =
        input.message_id === undefined
          ? `/channels/${input.channel_id}/threads`
          : `/channels/${input.channel_id}/messages/${input.message_id}/threads`;
      return summarizeThread(await rest.post(path, { body }));
    }
    case "edit_thread": {
      const input = command.input;
      await guildChannel(rest, input.thread_id);
      return summarizeThread(
        await rest.patch(`/channels/${input.thread_id}`, {
          body: compact({
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
      );
    }
    case "delete_thread": {
      const input = command.input;
      await guildChannel(rest, input.thread_id);
      const thread = record(await rest.delete(`/channels/${input.thread_id}`));
      return { success: true, deleted: thread.name ?? input.thread_id };
    }

    case "list_webhooks": {
      const input = command.input;
      if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
      const path: Parameters<DiscordRest["get"]>[0] =
        input.channel_id === undefined
          ? `/guilds/${DISCORD_GUILD_ID}/webhooks`
          : `/channels/${input.channel_id}/webhooks`;
      return records(await rest.get(path)).map(summarizeWebhook);
    }
    case "create_webhook": {
      const input = command.input;
      await guildChannel(rest, input.channel_id);
      const avatar = input.avatar === undefined ? undefined : await imageDataUri(input.avatar);
      return summarizeWebhook(
        await rest.post(`/channels/${input.channel_id}/webhooks`, {
          body: compact({ name: input.name, avatar }),
        }),
      );
    }
    case "edit_webhook": {
      const input = command.input;
      await guildWebhook(rest, input.webhook_id);
      if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
      const avatar = input.avatar === undefined ? undefined : await imageDataUri(input.avatar);
      return summarizeWebhook(
        await rest.patch(`/webhooks/${input.webhook_id}`, {
          body: compact({ name: input.name, avatar, channel_id: input.channel_id }),
        }),
      );
    }
    case "delete_webhook": {
      const input = command.input;
      const webhook = await guildWebhook(rest, input.webhook_id);
      await rest.delete(`/webhooks/${input.webhook_id}`);
      return { success: true, deleted: webhook.name ?? input.webhook_id };
    }
  }
  command satisfies never;
}

function summarizeAutoModRule(value: unknown) {
  const rule = record(value);
  return {
    id: rule.id,
    name: rule.name,
    eventType: rule.event_type,
    triggerType: rule.trigger_type,
    enabled: rule.enabled,
    triggerMetadata: rule.trigger_metadata,
    actions: Array.isArray(rule.actions) ? rule.actions : [],
    exemptRoles: Array.isArray(rule.exempt_roles) ? rule.exempt_roles : [],
    exemptChannels: Array.isArray(rule.exempt_channels) ? rule.exempt_channels : [],
  };
}
function summarizeMessage(value: unknown) {
  const message = record(value);
  const author = record(message.author);
  return {
    id: message.id,
    author: author.global_name ?? author.username,
    authorId: author.id,
    isBot: author.bot ?? false,
    content: message.content,
    timestamp: message.timestamp,
    editedTimestamp: message.edited_timestamp ?? null,
    pinned: message.pinned,
    attachments: records(message.attachments).map((attachment) => ({
      name: attachment.filename,
      url: attachment.url,
    })),
    embeds: Array.isArray(message.embeds) ? message.embeds.length : 0,
  };
}
function summarizeRole(role: Readonly<Record<string, unknown>>) {
  return {
    id: role.id,
    name: role.name,
    color: `#${Number(role.color ?? 0)
      .toString(16)
      .padStart(6, "0")}`,
    position: role.position,
  };
}
function summarizeInvite(value: unknown) {
  const invite = record(value);
  const channel = record(invite.channel);
  const creator = record(invite.inviter);
  return {
    code: invite.code,
    channel: channel.id === undefined ? null : { id: channel.id, name: channel.name },
    inviter: creator.id === undefined ? null : { id: creator.id, username: creator.username },
    uses: invite.uses,
    maxUses: invite.max_uses,
    maxAge: invite.max_age,
    temporary: invite.temporary,
    expiresAt: invite.expires_at ?? null,
  };
}
function byPosition(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): number {
  return Number(left.position) - Number(right.position);
}

/** Result remains inside the bot; the HTTP route serializes only a safe projection. */
export function executeDiscordCommand(
  rest: DiscordRest,
  command: DiscordCommand,
): Promise<Result<unknown, DiscordCommandError>> {
  return Result.tryPromise({
    try: () => execute(rest, command),
    catch: discordError(`execute Discord ${command.operation}`),
  });
}
