/**
 * Discord role and channel administration as ordinary provider calls.
 *
 * These operations used to travel over the bot's semantic command RPC; they are
 * plain Discord REST work with no dependency on the renderer's rate-limit
 * buckets, so the agent now performs them directly with its own REST identity.
 * The routes, request bodies and output projections are unchanged from the
 * bot-side executor they were relocated from.
 */

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  ChannelType,
  Routes,
  VideoQualityMode,
  type RESTGetAPIGuildChannelsResult,
  type RESTGetAPIGuildRolesResult,
  type RESTPatchAPIChannelJSONBody,
  type RESTPatchAPIGuildRoleJSONBody,
  type RESTPatchAPIGuildRolePositionsJSONBody,
  type RESTPatchAPIGuildRolePositionsResult,
  type RESTPatchAPIGuildRoleResult,
  type RESTPostAPIGuildChannelJSONBody,
  type RESTPostAPIGuildRoleJSONBody,
  type RESTPostAPIGuildRoleResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../lib/policy/domain-tools.ts";
import {
  compact,
  discordArray,
  discordObject,
  discordRest,
  malformedDiscordResponse,
} from "../rest.ts";
import {
  AUTO_ARCHIVE_DURATIONS,
  autoArchiveDuration,
  channelId,
  channelType,
  discordSnowflakeSchema,
  empty,
  guildChannel,
  httpUrl,
  imageDataUri,
  memberId,
  responseInt,
  roleId,
  slowmode,
  type GuildChannelResult,
} from "./common.ts";

// ──────────────── input primitives (mirrors of the wire schemas) ────────────────

const channelName = z.string().trim().min(1).max(100);
const hexColor = z.stringFormat("hex-color", /^#[0-9A-F]{6}$/iu);

// ──────────────── Discord enum tables ────────────────

const CHANNEL_TYPES = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  announcement: ChannelType.GuildAnnouncement,
  stage: ChannelType.GuildStageVoice,
  forum: ChannelType.GuildForum,
} as const;
const THREAD_CHANNEL_TYPES = new Set<number>([
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
]);

// ──────────────── projection helpers ────────────────

function positionedRole(
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

function channelPosition(channel: GuildChannelResult): number {
  const parsed = responseInt.safeParse("position" in channel ? channel.position : undefined);
  if (!parsed.success) throw malformedDiscordResponse("list guild channels");
  return parsed.data;
}

function byPosition(left: GuildChannelResult, right: GuildChannelResult): number {
  return channelPosition(left) - channelPosition(right);
}

// ──────────────── operations ────────────────

export const ROLE_CHANNEL_OPERATIONS = {
  create_role: defineTool({
    access: { risk: "write" },
    description:
      "Create a new role in the server. You can set the name, color, whether it is hoisted (displayed separately in the sidebar), mentionable, and an icon or unicode emoji.",
    input: z.strictObject({
      name: z.string().trim().min(1).max(100),
      color: hexColor.optional(),
      hoist: z.boolean().optional(),
      mentionable: z.boolean().optional(),
      position: z.int().min(1).optional(),
      icon: httpUrl.optional(),
      unicode_emoji: z.string().trim().min(1).max(32).optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
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
      if (input.position === undefined) return summarizeRole(role);
      const positioned = positionedRole(
        await rest.patch(Routes.guildRoles(DISCORD_GUILD_ID), {
          body: [
            { id: role.id, position: input.position },
          ] satisfies RESTPatchAPIGuildRolePositionsJSONBody,
        }),
        role.id,
      );
      return summarizeRole(positioned);
    },
  }),

  edit_role: defineTool({
    access: { risk: "destructive" },
    description:
      "Edit an existing role's settings including name, color, hoist, mentionable, icon, and unicode emoji.",
    input: z.strictObject({
      role_id: roleId,
      name: z.string().trim().min(1).max(100).optional(),
      color: hexColor.optional(),
      hoist: z.boolean().optional(),
      mentionable: z.boolean().optional(),
      position: z.int().min(1).optional(),
      icon: httpUrl.nullable().optional(),
      unicode_emoji: z.string().trim().min(1).max(32).nullable().optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      const icon =
        input.icon === undefined || input.icon === null
          ? input.icon
          : await imageDataUri(input.icon);
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
      if (input.position === undefined) return summarizeRole(role);
      const positioned = positionedRole(
        await rest.patch(Routes.guildRoles(DISCORD_GUILD_ID), {
          body: [
            { id: input.role_id, position: input.position },
          ] satisfies RESTPatchAPIGuildRolePositionsJSONBody,
        }),
        input.role_id,
      );
      return summarizeRole(positioned);
    },
  }),

  delete_role: defineTool({
    access: { risk: "destructive" },
    description:
      "Delete a role from the server. This is irreversible and will remove the role from all members who have it.",
    input: z.strictObject({ role_id: roleId }),
    execute: async (input) => {
      const rest = discordRest();
      const guildRoles = discordArray<RESTGetAPIGuildRolesResult>(
        await rest.get(Routes.guildRoles(DISCORD_GUILD_ID)),
        "list guild roles",
      );
      const targetRole = guildRoles.find((entry) => entry.id === input.role_id);
      if (targetRole === undefined) return { error: "Role not found" };
      await rest.delete(Routes.guildRole(DISCORD_GUILD_ID, input.role_id));
      return { success: true, deleted: targetRole.name };
    },
  }),

  assign_role: defineTool({
    access: { risk: "destructive" },
    description:
      "Assign a role to a server member. Requires both the member's user ID and the role ID.",
    input: z.strictObject({ member_id: memberId, role_id: roleId }),
    execute: async (input) => {
      const rest = discordRest();
      await rest.put(Routes.guildMemberRole(DISCORD_GUILD_ID, input.member_id, input.role_id));
      return { success: true, member: input.member_id, role: input.role_id };
    },
  }),

  remove_role: defineTool({
    access: { risk: "destructive" },
    description:
      "Remove a role from a server member. Requires both the member's user ID and the role ID.",
    input: z.strictObject({ member_id: memberId, role_id: roleId }),
    execute: async (input) => {
      const rest = discordRest();
      await rest.delete(Routes.guildMemberRole(DISCORD_GUILD_ID, input.member_id, input.role_id));
      return { success: true, member: input.member_id, role: input.role_id };
    },
  }),

  list_roles: defineTool({
    access: { risk: "read" },
    description:
      "List all roles in the Discord server with their colors, positions, and whether they are hoisted or mentionable. Use this to find role IDs before assigning or managing roles.",
    input: empty,
    execute: async () => {
      const rest = discordRest();
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
    },
  }),

  create_channel: defineTool({
    access: { risk: "write" },
    description:
      "Create a new channel in the Discord server. Supports text, voice, category, announcement, forum, and stage channel types. Returns the created channel's details.",
    input: z.strictObject({
      name: channelName,
      type: z.enum(["text", "voice", "category", "announcement", "forum", "stage"]).default("text"),
      topic: z.string().max(1_024).optional(),
      parent_id: discordSnowflakeSchema.optional(),
      nsfw: z.boolean().optional(),
      slowmode: slowmode.optional(),
      position: z.int().min(0).optional(),
      bitrate: z.int().min(8_000).max(512_000).optional(),
      user_limit: z.int().min(0).max(99).optional(),
      rtc_region: z.string().trim().min(1).max(100).optional(),
      video_quality_mode: z.enum(["auto", "full"]).optional(),
      default_auto_archive_duration: autoArchiveDuration.optional(),
      default_thread_slowmode: slowmode.optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
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
    },
  }),

  edit_channel: defineTool({
    access: { risk: "write" },
    description:
      "Edit an existing channel's settings such as name, topic, slowmode, position, NSFW flag, parent category, and voice-specific settings.",
    input: z.strictObject({
      channel_id: channelId,
      name: channelName.optional(),
      topic: z.string().max(1_024).optional(),
      parent_id: discordSnowflakeSchema.nullable().optional(),
      nsfw: z.boolean().optional(),
      slowmode: slowmode.optional(),
      position: z.int().min(0).optional(),
      bitrate: z.int().min(8_000).max(512_000).optional(),
      user_limit: z.int().min(0).max(99).optional(),
      rtc_region: z.string().trim().min(1).max(100).nullable().optional(),
      video_quality_mode: z.enum(["auto", "full"]).optional(),
      default_auto_archive_duration: autoArchiveDuration.optional(),
      default_thread_slowmode: slowmode.optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      if (input.parent_id !== undefined && input.parent_id !== null)
        await guildChannel(rest, input.parent_id);
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
    },
  }),

  get_channel: defineTool({
    access: { risk: "read" },
    description:
      "Get a single channel's details by ID. Returns type, name, topic, position, parent category, and other settings.",
    input: z.strictObject({ channel_id: channelId }),
    execute: async (input) => summarizeChannel(await guildChannel(discordRest(), input.channel_id)),
  }),

  delete_channel: defineTool({
    access: { risk: "destructive" },
    description:
      "Delete a channel from the server. This is irreversible and will permanently remove the channel and all its messages.",
    input: z.strictObject({ channel_id: channelId }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      const deleted = discordObject<GuildChannelResult>(
        await rest.delete(Routes.channel(input.channel_id)),
        "delete channel",
      );
      return { success: true, deleted: deleted.name ?? input.channel_id };
    },
  }),

  list_channels: defineTool({
    access: { risk: "read" },
    description:
      "List all channels in the Discord server, organized by category. Returns channel IDs, names, types, topics, and positions. Use this to find the right channel before sending messages or performing channel operations.",
    input: empty,
    execute: async () => {
      const rest = discordRest();
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
          : // oxlint-disable-next-line unicorn/no-null -- the uncategorized group carries an explicit null category, matching Discord's own "no parent" encoding.
            [{ category: null, channels: uncategorized.map(summarizeChannel) }]),
      ];
    },
  }),
} as const;
