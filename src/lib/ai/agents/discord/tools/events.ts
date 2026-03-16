import { tool } from "ai";
import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { env } from "../../../../../env.ts";
import { discord } from "../client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Entity types: 1=stage, 2=voice, 3=external
const ENTITY_TYPE_MAP: Record<string, number> = {
  stage: 1,
  voice: 2,
  external: 3,
};

// Event status: 1=scheduled, 2=active, 3=completed, 4=cancelled
const STATUS_MAP: Record<string, number> = {
  scheduled: 1,
  active: 2,
  completed: 3,
  canceled: 4,
};

function summarizeEvent(e: any) {
  return {
    id: e.id,
    name: e.name,
    description: e.description ?? null,
    scheduledStartAt: e.scheduled_start_time ?? null,
    scheduledEndAt: e.scheduled_end_time ?? null,
    status: e.status,
    entityType: e.entity_type,
    channelId: e.channel_id ?? null,
    location: e.entity_metadata?.location ?? null,
    userCount: e.user_count ?? null,
    creatorId: e.creator_id ?? null,
    image: e.image
      ? `https://cdn.discordapp.com/guild-events/${e.id}/${e.image}.png`
      : null,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const list_events = tool({
  description:
    "List all scheduled events in the server. Returns event details including name, description, times, type, location, and attendee count.",
  inputSchema: z.object({}),
  execute: async () => {
    const events = (await discord.get(
      Routes.guildScheduledEvents(env.DISCORD_GUILD_ID),
      {
        query: new URLSearchParams({ with_user_count: "true" }),
      },
    )) as any[];
    return JSON.stringify(events.map(summarizeEvent));
  },
});

export const create_event = tool({
  description:
    "Create a scheduled event in the server. Supports voice channel events, stage events, and external (location-based) events. External events require an end time and location.",
  inputSchema: z.object({
    name: z.string().describe("Event name"),
    description: z.string().optional().describe("Event description"),
    scheduled_start: z.string().describe("Start time (ISO 8601 string)"),
    scheduled_end: z
      .string()
      .optional()
      .describe("End time (ISO 8601 string, required for external events)"),
    type: z
      .enum(["voice", "stage", "external"])
      .default("external")
      .describe("Event type"),
    channel_id: z
      .string()
      .optional()
      .describe("Voice/stage channel ID (required for voice/stage events)"),
    location: z
      .string()
      .optional()
      .describe("Location string (required for external events)"),
    image: z.string().optional().describe("Cover image URL"),
  }),
  execute: async ({
    name,
    description,
    scheduled_start,
    scheduled_end,
    type,
    channel_id,
    location,
    image,
  }) => {
    const entityType = ENTITY_TYPE_MAP[type] ?? 3;

    const body: Record<string, any> = {
      name,
      scheduled_start_time: scheduled_start,
      privacy_level: 2, // GUILD_ONLY
      entity_type: entityType,
    };
    if (description) body.description = description;
    if (scheduled_end) body.scheduled_end_time = scheduled_end;
    if (channel_id) body.channel_id = channel_id;
    if (location) body.entity_metadata = { location };
    if (image) body.image = image;

    const event = (await discord.post(
      Routes.guildScheduledEvents(env.DISCORD_GUILD_ID),
      {
        body,
      },
    )) as any;

    return JSON.stringify({
      id: event.id,
      name: event.name,
      scheduledStartAt: event.scheduled_start_time,
      scheduledEndAt: event.scheduled_end_time ?? null,
      status: event.status,
    });
  },
});

export const edit_event = tool({
  description:
    "Edit a scheduled event's name, description, times, location, image, status, or channel. Use status to start ('active'), end ('completed'), or cancel ('canceled') an event.",
  inputSchema: z.object({
    event_id: z.string().describe("Event ID"),
    name: z.string().optional().describe("New event name"),
    description: z.string().optional().describe("New description"),
    scheduled_start: z
      .string()
      .optional()
      .describe("New start time (ISO 8601)"),
    scheduled_end: z.string().optional().describe("New end time (ISO 8601)"),
    location: z
      .string()
      .optional()
      .describe("New location (external events only)"),
    image: z.string().optional().describe("New cover image URL"),
    status: z
      .enum(["scheduled", "active", "completed", "canceled"])
      .optional()
      .describe(
        "New event status (e.g. 'active' to start, 'completed' or 'canceled' to end)",
      ),
    channel_id: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Voice/stage channel ID (null to clear, for voice/stage events)",
      ),
  }),
  execute: async ({
    event_id,
    name,
    description,
    scheduled_start,
    scheduled_end,
    location,
    image,
    status,
    channel_id,
  }) => {
    const body: Record<string, any> = {};
    if (name) body.name = name;
    if (description !== undefined) body.description = description;
    if (scheduled_start) body.scheduled_start_time = scheduled_start;
    if (scheduled_end) body.scheduled_end_time = scheduled_end;
    if (location) body.entity_metadata = { location };
    if (image) body.image = image;
    if (status) body.status = STATUS_MAP[status];
    if (channel_id !== undefined) body.channel_id = channel_id;

    const edited = (await discord.patch(
      Routes.guildScheduledEvent(env.DISCORD_GUILD_ID, event_id),
      { body },
    )) as any;

    return JSON.stringify({
      id: edited.id,
      name: edited.name,
      scheduledStartAt: edited.scheduled_start_time,
      scheduledEndAt: edited.scheduled_end_time ?? null,
      status: edited.status,
    });
  },
});

export const delete_event = tool({
  description:
    "Delete a scheduled event. This is irreversible and will notify users who have indicated interest.",
  inputSchema: z.object({
    event_id: z.string().describe("Event ID to delete"),
  }),
  execute: async ({ event_id }) => {
    // Fetch event first to get its name
    const event = (await discord.get(
      Routes.guildScheduledEvent(env.DISCORD_GUILD_ID, event_id),
    )) as any;
    await discord.delete(
      Routes.guildScheduledEvent(env.DISCORD_GUILD_ID, event_id),
    );
    return JSON.stringify({ success: true, deleted: event.name });
  },
});
