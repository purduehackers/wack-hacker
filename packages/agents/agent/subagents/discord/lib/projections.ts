/**
 * @fileoverview Response projections and wire-shape helpers shared across
 * this domain's tools.
 *
 * `summarize*` is the shape the model reads. A list tool and its matching get
 * tool must never disagree about it, so each projection lives here once. The
 * guild scope guards sit beside them because every channel and webhook
 * projection first passes through one. The wire primitives these helpers
 * narrow with stay in `./constants.ts`.
 */

import type { REST } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { UpstreamError } from "@repo/shared/errors";
import { discordSnowflake } from "@repo/shared/formats";
import {
  AutoModerationActionType,
  ChannelType,
  Routes,
  StickerFormatType,
  type APIThreadChannel,
  type RESTAPIGuildChannelResolvable,
  type RESTGetAPIAutoModerationRuleResult,
  type RESTGetAPIChannelMessageResult,
  type RESTGetAPIGuildEmojisResult,
  type RESTGetAPIGuildInvitesResult,
  type RESTGetAPIGuildMemberResult,
  type RESTGetAPIGuildRolesResult,
  type RESTGetAPIGuildScheduledEventsResult,
  type RESTGetAPIGuildStickersResult,
  type RESTGetAPIGuildWebhooksResult,
  type RESTPatchAPIGuildRolePositionsResult,
  type RESTPostAPIAutoModerationRuleJSONBody,
} from "discord-api-types/v10";
import type { z } from "zod";

import { compact, discordArray, discordObject, malformedDiscordResponse } from "./client.ts";
import {
  responseInt,
  responseString,
  type autoModActionSchema,
  type autoModMetadataSchema,
} from "./constants.ts";

// ──────────────── Discord enum tables ────────────────

/** Raw channel-type integers to model-facing names. Numbers outside it degrade to `unknown(n)`. */
const CHANNEL_TYPE_NAMES = new Map<number, string>([
  [ChannelType.GuildText, "text"],
  [ChannelType.GuildVoice, "voice"],
  [ChannelType.GuildCategory, "category"],
  [ChannelType.GuildAnnouncement, "announcement"],
  [ChannelType.AnnouncementThread, "announcement_thread"],
  [ChannelType.PublicThread, "public_thread"],
  [ChannelType.PrivateThread, "private_thread"],
  [ChannelType.GuildStageVoice, "stage"],
  [ChannelType.GuildForum, "forum"],
]);
const AUTO_MOD_ACTION_TYPES = {
  1: AutoModerationActionType.BlockMessage,
  2: AutoModerationActionType.SendAlertMessage,
  3: AutoModerationActionType.Timeout,
  4: AutoModerationActionType.BlockMemberInteraction,
} as const;

// ──────────────── auto-moderation wire projections ────────────────

type AutoModMetadataInput = z.output<typeof autoModMetadataSchema> | undefined;
type AutoModActionInput = z.output<typeof autoModActionSchema>;

/**
 * Projects validated trigger metadata onto the wire body. A field the model
 * left unset stays absent instead of becoming a present `undefined` key,
 * because Discord's wire format distinguishes the two.
 */
export function autoModMetadata(
  metadata: AutoModMetadataInput,
): RESTPostAPIAutoModerationRuleJSONBody["trigger_metadata"] {
  if (metadata === undefined) return undefined;
  return compact({
    ...(metadata.keyword_filter !== undefined && { keyword_filter: metadata.keyword_filter }),
    ...(metadata.regex_patterns !== undefined && { regex_patterns: metadata.regex_patterns }),
    ...(metadata.presets !== undefined && { presets: metadata.presets }),
    ...(metadata.allow_list !== undefined && { allow_list: metadata.allow_list }),
    ...(metadata.mention_total_limit !== undefined && {
      mention_total_limit: metadata.mention_total_limit,
    }),
    ...(metadata.mention_raid_protection_enabled !== undefined && {
      mention_raid_protection_enabled: metadata.mention_raid_protection_enabled,
    }),
  });
}

function autoModActionMetadata(action: AutoModActionInput) {
  const custom = action.metadata?.custom_message;
  const message = custom === undefined ? {} : { custom_message: custom };
  if (action.type === 2) return { ...message, channel_id: action.metadata.channel_id };
  if (action.type === 3) return { ...message, duration_seconds: action.metadata.duration_seconds };
  return action.metadata === undefined ? undefined : message;
}

/**
 * Projects one validated action onto the wire shape. The metadata arm follows
 * the action's type. An alert keeps its channel, a timeout keeps its duration,
 * and nothing else leaks through.
 */
export function autoModAction(
  action: AutoModActionInput,
): RESTPostAPIAutoModerationRuleJSONBody["actions"][number] {
  const metadata = autoModActionMetadata(action);
  return compact({
    type: AUTO_MOD_ACTION_TYPES[action.type],
    ...(metadata !== undefined && { metadata }),
  });
}

// ──────────────── guild scope guards ────────────────

export type GuildChannelResult = RESTAPIGuildChannelResolvable;
/** Webhook tokens/URLs are deliberately never projected to the model. */
export type WebhookResult = RESTGetAPIGuildWebhooksResult[number];
export type ThreadResult = APIThreadChannel;

/** Every channel touched by these tools must belong to the single managed guild. */
export async function guildChannel(rest: REST, id: string): Promise<GuildChannelResult> {
  const channel = discordObject<GuildChannelResult>(
    await rest.get(Routes.channel(id)),
    "get channel",
  );
  if (channel.guild_id !== DISCORD_GUILD_ID) {
    throw new UpstreamError({
      service: "Discord",
      status: 403,
      detail: "channel is outside the managed guild",
    });
  }
  return channel;
}

/** The same scope guard for webhooks, which are addressable without a guild id. */
export async function guildWebhook(rest: REST, id: string): Promise<WebhookResult> {
  const webhook = discordObject<WebhookResult>(await rest.get(Routes.webhook(id)), "get webhook");
  if (webhook.guild_id !== DISCORD_GUILD_ID) {
    throw new UpstreamError({
      service: "Discord",
      status: 403,
      detail: "webhook is outside the managed guild",
    });
  }
  return webhook;
}

// ──────────────── projection helpers ────────────────

/**
 * Names a raw channel type for the model. A number outside the table comes
 * back as `unknown(n)` so a new Discord channel kind degrades visibly instead
 * of failing the whole projection. A non-integer value throws as a malformed
 * Discord response.
 */
export function channelType(value: number): string {
  const parsed = responseInt.safeParse(value);
  if (!parsed.success) throw malformedDiscordResponse("channel type");
  return CHANNEL_TYPE_NAMES.get(parsed.data) ?? `unknown(${parsed.data})`;
}

/**
 * The channel projection every listing and mutation returns. `topic` and
 * `position` appear only on the kinds that carry them, and `compact` keeps the
 * absent ones out of the model's context.
 */
export function summarizeChannel(channel: GuildChannelResult) {
  return compact({
    id: channel.id,
    name: channel.name,
    type: channelType(channel.type),
    topic: "topic" in channel ? channel.topic : undefined,
    parentId: channel.parent_id ?? undefined,
    position: "position" in channel ? channel.position : undefined,
  });
}

/**
 * The role projection the model reads. The raw color integer becomes a CSS
 * hex string because the model round-trips that spelling through `hexColor`
 * on writes.
 */
export function summarizeRole(role: RESTGetAPIGuildRolesResult[number]) {
  return {
    id: role.id,
    name: role.name,
    color: `#${Number(role.color ?? 0)
      .toString(16)
      .padStart(6, "0")}`,
    position: role.position,
  };
}

/** A second call sets a role's position, and its result carries the new order. */
export function positionedRole(
  value: unknown,
  targetRoleId: string,
): RESTPatchAPIGuildRolePositionsResult[number] {
  const positionResults = discordArray<RESTPatchAPIGuildRolePositionsResult>(
    value,
    "modify guild role positions",
  );
  const positioned = positionResults.find((candidate) => candidate.id === targetRoleId);
  if (positioned === undefined)
    throw malformedDiscordResponse("modify guild role positions target role");
  return positioned;
}

/**
 * The member projection the model reads. A member payload must carry its
 * `user` object, so the projection throws on one that does not rather than
 * inventing a partial member.
 */
export function summarizeMember(member: RESTGetAPIGuildMemberResult) {
  const user = discordObject<RESTGetAPIGuildMemberResult["user"]>(member.user, "guild member user");
  return {
    id: user.id,
    username: user.username,
    displayName: user.global_name ?? user.username,
    nickname: member.nick ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    roles: member.roles,
    joinedAt: member.joined_at ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    isBot: user.bot ?? false,
  };
}

/**
 * The auto-mod rule projection the model reads. It carries the full trigger
 * and exemption detail so the model can reason about a rule before editing
 * it.
 */
export function summarizeAutoModRule(rule: RESTGetAPIAutoModerationRuleResult) {
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

/**
 * The scheduled-event projection the model reads. The CDN image URL exists
 * only when both the event id and image hash validate. A malformed pair
 * degrades to `null` rather than a broken link.
 */
export function summarizeEvent(event: ScheduledEventResult) {
  const metadata =
    event.entity_metadata === null
      ? null // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
      : discordObject<NonNullable<ScheduledEventResult["entity_metadata"]>>(
          event.entity_metadata,
          "guild scheduled event metadata",
        );
  const eventId = discordSnowflake.safeParse(event.id).data;
  const eventImage = responseString.safeParse(event.image).data;
  return {
    id: event.id,
    name: event.name,
    description: event.description ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    scheduledStartAt: event.scheduled_start_time ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    scheduledEndAt: event.scheduled_end_time ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    status: event.status,
    entityType: event.entity_type,
    channelId: event.channel_id ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    location: metadata?.location ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    userCount: event.user_count ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    creatorId: event.creator_id ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    image:
      eventId === undefined || eventImage === undefined
        ? null // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
        : `https://cdn.discordapp.com/guild-events/${eventId}/${eventImage}.png`,
  };
}

/**
 * The invite projection the model reads. Discord may omit the channel or the
 * inviter, so both collapse to `null` instead of surfacing two different
 * absence spellings.
 */
export function summarizeInvite(invite: RESTGetAPIGuildInvitesResult[number]) {
  const channel =
    invite.channel === null
      ? null // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
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
    channel: channel === null ? null : { id: channel.id, name: channel.name }, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    inviter: creator === undefined ? null : { id: creator.id, username: creator.username }, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    uses: invite.uses,
    maxUses: invite.max_uses,
    maxAge: invite.max_age,
    temporary: invite.temporary,
    expiresAt: invite.expires_at ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
  };
}

type EmojiResult = RESTGetAPIGuildEmojisResult[number];
type StickerResult = RESTGetAPIGuildStickersResult[number];

/**
 * The emoji projection the model reads. The CDN URL picks `gif` for animated
 * emojis, and an id that fails the snowflake check yields a `null` URL rather
 * than a fabricated link.
 */
export function summarizeEmoji(emoji: EmojiResult) {
  const animated = emoji.animated ?? false;
  const id = discordSnowflake.safeParse(emoji.id).data;
  return {
    id: emoji.id,
    name: emoji.name,
    animated,
    url:
      id === undefined
        ? null // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
        : `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`,
    roles: emoji.roles ?? [],
    createdAt: emoji.id,
  };
}

/**
 * The sticker projection the model reads. A Lottie sticker gets a `json` CDN
 * URL while every raster format gets `png`, and a bad id yields a `null` URL.
 */
export function summarizeSticker(sticker: StickerResult) {
  const id = discordSnowflake.safeParse(sticker.id).data;
  return {
    id: sticker.id,
    name: sticker.name,
    description: sticker.description ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    tags: sticker.tags,
    formatType: sticker.format_type,
    available: sticker.available,
    url:
      id === undefined
        ? null // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
        : `https://cdn.discordapp.com/stickers/${id}.${sticker.format_type === StickerFormatType.Lottie ? "json" : "png"}`,
  };
}

/**
 * The webhook projection the model reads. The token never appears here — see
 * `WebhookResult` — and the avatar URL exists only when both the id and the
 * avatar hash validate.
 */
export function summarizeWebhook(webhook: WebhookResult) {
  const id = discordSnowflake.safeParse(webhook.id).data;
  const avatar = responseString.safeParse(webhook.avatar).data;
  return {
    id: webhook.id,
    name: webhook.name,
    channelId: webhook.channel_id,
    avatar:
      id === undefined || avatar === undefined
        ? null // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
        : `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`,
    createdAt: webhook.id,
  };
}

/**
 * The thread projection the model reads. Thread metadata is optional on the
 * wire, so archive and lock state default to `false` and the counts default
 * to zero rather than reporting absence.
 */
export function summarizeThread(thread: ThreadResult) {
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
    parentId: thread.parent_id ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    archived: metadata?.archived ?? false,
    locked: metadata?.locked ?? false,
    autoArchiveDuration: metadata?.auto_archive_duration ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    messageCount: thread.message_count ?? 0,
    memberCount: thread.member_count ?? 0,
    createdAt: metadata?.create_timestamp ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    type: channelType(thread.type),
  };
}

/**
 * The message projection the model reads. Attachments keep name and URL only,
 * and embeds collapse to a count, so a media-heavy message cannot flood the
 * context window.
 */
export function summarizeMessage(message: RESTGetAPIChannelMessageResult) {
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
    editedTimestamp: message.edited_timestamp ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
    pinned: message.pinned,
    attachments: discordArray<RESTGetAPIChannelMessageResult["attachments"]>(
      message.attachments,
      "message attachments",
    ).map((attachment) => ({
      name: attachment.filename,
      url: attachment.url,
    })),
    embeds: discordArray<RESTGetAPIChannelMessageResult["embeds"]>(message.embeds, "message embeds")
      .length,
  };
}

// ──────────────── image sourcing ────────────────

const IMAGE_TIMEOUT_MS = 15_000;

/**
 * Fetches an image with a 15-second timeout and a hard size cap. Only content
 * types on the caller's accept list pass. The check reads the declared
 * `content-length` first, but the real byte count decides, because a server
 * can lie about or omit the header. Rejections carry the matching HTTP
 * status: 415 for type, 413 for size.
 */
export async function download(url: string, maxBytes: number, accepted: readonly string[]) {
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

/**
 * Inlines a remote image as a base64 data URI, the spelling Discord's asset
 * endpoints expect. The 256 KiB default suits the smallest asset budgets, and
 * a caller with a larger cap, like event banners, passes its own.
 */
export async function imageDataUri(url: string, maxBytes = 256 * 1_024): Promise<string> {
  const image = await download(url, maxBytes, [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ]);
  return `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}
