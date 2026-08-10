import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  Routes,
  type RESTPostAPIGuildScheduledEventJSONBody,
  type RESTPostAPIGuildScheduledEventResult,
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

const EVENT_TYPES = {
  stage: GuildScheduledEventEntityType.StageInstance,
  voice: GuildScheduledEventEntityType.Voice,
  external: GuildScheduledEventEntityType.External,
} as const;

/**
 * Discord's three event kinds take mutually exclusive fields, and rejecting the
 * wrong combination here names the missing field rather than returning a 400
 * the model has to guess at.
 */
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

export const create_event = defineTool({
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
});
