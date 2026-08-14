import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  ChannelType,
  Routes,
  VideoQualityMode,
  type RESTPostAPIGuildChannelJSONBody,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import {
  autoArchiveDuration,
  AUTO_ARCHIVE_DURATIONS,
  channelName,
  discordSnowflakeSchema,
  guildChannel,
  slowmode,
  summarizeChannel,
  type GuildChannelResult,
} from "../../constants.ts";

/** The channel kinds this domain will create. Threads come from create_thread. */
const CHANNEL_TYPES = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  announcement: ChannelType.GuildAnnouncement,
  stage: ChannelType.GuildStageVoice,
  forum: ChannelType.GuildForum,
} as const;

export const create_channel = defineTool({
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
});
