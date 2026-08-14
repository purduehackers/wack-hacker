import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  GuildScheduledEventStatus,
  Routes,
  type RESTPatchAPIGuildScheduledEventJSONBody,
  type RESTPatchAPIGuildScheduledEventResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import {
  discordSnowflakeSchema,
  EVENT_IMAGE_MAX_BYTES,
  guildChannel,
  httpUrl,
  imageDataUri,
  isoDateTime,
  summarizeEvent,
} from "../../constants.ts";

const EVENT_STATUSES = {
  scheduled: GuildScheduledEventStatus.Scheduled,
  active: GuildScheduledEventStatus.Active,
  completed: GuildScheduledEventStatus.Completed,
  canceled: GuildScheduledEventStatus.Canceled,
} as const;

export const edit_event = defineTool({
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
});
