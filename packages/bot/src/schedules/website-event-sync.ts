/** Daily creation of Discord events for published events on the website. */

import { REST } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, Routes } from "discord.js";
import type { GuildScheduledEvent, GuildScheduledEventCreateOptions } from "discord.js";
import { z } from "zod";

import type { Schedule } from "../framework/schedules.ts";
import type { CmsClient, CmsSyncEvent } from "../integrations/cms.ts";

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1_000;
const DESCRIPTION_LIMIT = 1_000;
const EVENTS_ORIGIN = "https://events.purduehackers.com";

const lexicalNodeSchema = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
  children: z.array(z.unknown()).optional(),
});
const richTextSchema = z.object({ root: z.unknown() });
const createdEventSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  scheduled_start_time: z.iso.datetime({ offset: true }),
});

/** Lexical containers preserve paragraph breaks and inline text adjacency. */
function lexicalText(value: unknown): string {
  const parsed = lexicalNodeSchema.safeParse(value);
  if (!parsed.success) return "";
  const node = parsed.data;
  if (node.type === "linebreak") return "\n";
  const text = node.text ?? (node.children ?? []).map(lexicalText).join("");
  return ["paragraph", "heading", "listitem"].includes(node.type ?? "") ? `${text}\n` : text;
}

function descriptionText(value: unknown): string {
  const plain = z.string().safeParse(value);
  if (plain.success) return plain.data.trim();
  const rich = richTextSchema.safeParse(value);
  return rich.success ? lexicalText(rich.data.root).trim() : "";
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

export interface WebsiteEvent {
  readonly sourceUrl: string;
  readonly options: GuildScheduledEventCreateOptions;
}

/** A separate REST writer keeps ambiguous POSTs out of the gateway's default retries. */
async function createDiscordEvent(rest: REST, options: GuildScheduledEventCreateOptions) {
  const raw = await rest.post(Routes.guildScheduledEvents(DISCORD_GUILD_ID), {
    body: {
      name: options.name,
      scheduled_start_time: new Date(options.scheduledStartTime).toISOString(),
      scheduled_end_time:
        options.scheduledEndTime === undefined
          ? undefined
          : new Date(options.scheduledEndTime).toISOString(),
      privacy_level: options.privacyLevel,
      entity_type: options.entityType,
      entity_metadata: options.entityMetadata,
      description: options.description,
    },
    reason: "Daily sync of published website events",
  });
  const created = createdEventSchema.parse(raw);
  return {
    name: created.name,
    description: created.description ?? "",
    scheduledStartTimestamp: Date.parse(created.scheduled_start_time),
  };
}

/** No draft or already-started event is eligible, even if the CMS filter fails. */
export function websiteEvent(event: CmsSyncEvent, now: Date): WebsiteEvent | undefined {
  const start = Date.parse(event.start ?? "");
  if (!event.published || !Number.isFinite(start) || start <= now.getTime()) {
    return undefined;
  }
  const name = event.name?.trim();
  const slug = event.slug?.trim();
  const category = event.eventType?.trim().toLowerCase();
  if (!name || !slug || !category) return undefined;

  const sourceUrl = `${EVENTS_ORIGIN}/events/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`;
  // The id survives a title, slug, or category change. It is part of the link,
  // so the website remains the useful user-facing identity of the event.
  const link = `${sourceUrl}#cms-event-${encodeURIComponent(String(event.id))}`;
  const end = Date.parse(event.end ?? "");
  const estimated = !Number.isFinite(end) || end <= start;
  const footer = `${estimated ? "End time is estimated; check the website for details.\n\n" : ""}${link}`;
  if (footer.length > DESCRIPTION_LIMIT) return undefined;
  const text = descriptionText(event.description);
  const available = DESCRIPTION_LIMIT - footer.length - 2;
  const description = text && available > 1 ? `${truncate(text, available)}\n\n${footer}` : footer;

  return {
    sourceUrl,
    options: {
      name: truncate(name, 100),
      scheduledStartTime: start,
      scheduledEndTime: estimated ? start + DEFAULT_DURATION_MS : end,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: {
        location: truncate(event.location_name?.trim() || "See event website", 100),
      },
      description,
      reason: "Daily sync of published website events",
    },
  };
}

type ExistingEvent = Pick<GuildScheduledEvent, "name" | "description" | "scheduledStartTimestamp">;

/** Match stable CMS identity, an existing website link, or a manually created equivalent. */
function alreadyExists(
  existing: ExistingEvent,
  source: CmsSyncEvent,
  event: WebsiteEvent,
): boolean {
  const foundLinks = (existing.description ?? "").match(/https?:\/\/[^\s<>]+/g) ?? [];
  const marker = `#cms-event-${encodeURIComponent(String(source.id))}`;
  return (
    foundLinks.some((link) => {
      const url = URL.parse(link.replace(/[)\].,]+$/, ""));
      return (
        url?.origin === EVENTS_ORIGIN &&
        (url.hash === marker ||
          `${url.origin}${url.pathname.replace(/\/$/, "")}` === event.sourceUrl)
      );
    }) ||
    (existing.name.trim().toLowerCase() === event.options.name.toLowerCase() &&
      existing.scheduledStartTimestamp === event.options.scheduledStartTime)
  );
}

export interface WebsiteEventSyncDeps {
  readonly cms: Pick<CmsClient, "listUpcomingPublishedEvents">;
  readonly events: {
    readonly list: () => Promise<readonly ExistingEvent[]>;
    readonly create: (options: GuildScheduledEventCreateOptions) => Promise<ExistingEvent>;
  };
}

/** Re-reading Discord each day also recovers a create whose response was lost. */
export async function syncWebsiteEvents(deps: WebsiteEventSyncDeps, now = new Date()) {
  const listed = await deps.cms.listUpcomingPublishedEvents(now);
  if (Result.isError(listed)) return listed;

  return Result.tryPromise({
    try: async () => {
      const existing = [...(await deps.events.list())];
      const initialCount = existing.length;
      const attemptedIds = new Set<string>();
      const failures: string[] = [];
      for (const source of listed.value) {
        const event = websiteEvent(source, now);
        if (event === undefined) {
          console.warn(`website-event-sync: skipped ineligible CMS event ${source.id}`);
          continue;
        }
        const sourceId = String(source.id);
        if (
          attemptedIds.has(sourceId) ||
          existing.some((candidate) => alreadyExists(candidate, source, event))
        ) {
          continue;
        }
        // No blind retry on POST: an ambiguous failure may already have created
        // the event. Even duplicate CMS rows must get only one attempt per run.
        attemptedIds.add(sourceId);
        try {
          existing.push(await deps.events.create(event.options));
        } catch (cause) {
          failures.push(`CMS event ${sourceId}: ${messageOf(cause)}`);
        }
      }
      console.info(`website-event-sync: created ${existing.length - initialCount} event(s)`);
      // Report partial failure after the batch so one bad event cannot starve
      // the rest. Tomorrow's fresh Discord list reconciles ambiguous writes.
      if (failures.length > 0) throw new Error(failures.join("\n"));
      return undefined;
    },
    catch: (cause) =>
      new Transient({ operation: "sync website events to Discord", detail: messageOf(cause) }),
  });
}

export function websiteEventSync(deps: { readonly cms: WebsiteEventSyncDeps["cms"] }) {
  // Retain the writer's rate-limit buckets across runs, but never retry a
  // timeout or 5xx POST: Discord offers no event-creation idempotency key.
  const writer = new REST({ retries: 0 });
  return {
    name: "website-event-sync",
    cron: "0 9 * * *",
    run: async ({ client }) => {
      const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
      writer.setToken(client.token);
      return syncWebsiteEvents({
        cms: deps.cms,
        events: {
          list: async () => [...(await guild.scheduledEvents.fetch()).values()],
          create: (options) => createDiscordEvent(writer, options),
        },
      });
    },
  } satisfies Schedule;
}
