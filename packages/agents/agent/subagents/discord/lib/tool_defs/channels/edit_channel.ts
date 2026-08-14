import { Routes, VideoQualityMode, type RESTPatchAPIChannelJSONBody } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import {
  autoArchiveDuration,
  AUTO_ARCHIVE_DURATIONS,
  channelId,
  channelName,
  discordSnowflakeSchema,
  slowmode,
} from "../../constants.ts";
import { guildChannel, summarizeChannel, type GuildChannelResult } from "../../projections.ts";

export const edit_channel = defineTool({
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
});
