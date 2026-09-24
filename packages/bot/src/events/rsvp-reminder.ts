/** A Discord event subscription still needs a registration on the event's RSVP site. */

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf, tagOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import { DiscordAPIError } from "discord.js";

import { defineEvent } from "../framework/events.ts";
import { lumaUrl } from "../integrations/cms.ts";
import type { CmsClient } from "../integrations/cms.ts";

const EVENTS_ORIGIN = "https://events.purduehackers.com";
const URL_PATTERN = /https?:\/\/[^\s<>]+/giu;
const TRAILING_PUNCTUATION = /[)\].,!?;]+$/u;
const CMS_MARKER = /^#cms-event-([a-z\d-]+)$/iu;

interface RsvpLinks {
  readonly luma?: string;
  readonly website?: string;
  readonly cmsEventId?: string;
}

/** Links embedded in an event's description or external-event location. */
export function rsvpLinks(
  description: string | null,
  location: string | null | undefined,
): RsvpLinks {
  const candidates = [...`${description ?? ""}\n${location ?? ""}`.matchAll(URL_PATTERN)].flatMap(
    ([match]) => {
      const parsed = URL.parse(match.replace(TRAILING_PUNCTUATION, ""));
      return parsed === null ? [] : [parsed];
    },
  );

  const directLuma = candidates
    .map((link) => lumaUrl(link.href))
    .find((link) => link !== undefined);
  // The sync appends its canonical, ID-marked link after the description, which
  // may itself mention other events. Prefer that footer to those incidental links.
  const isEventPage = (link: URL) =>
    link.origin === EVENTS_ORIGIN && link.pathname.startsWith("/events/");
  const website =
    candidates.findLast((link) => isEventPage(link) && CMS_MARKER.test(link.hash)) ??
    candidates.find(isEventPage) ??
    candidates.find((link) => link.origin === EVENTS_ORIGIN);
  const marker = website === undefined ? undefined : CMS_MARKER.exec(website.hash);
  if (website !== undefined) website.hash = "";

  return {
    ...(directLuma !== undefined && { luma: directLuma }),
    ...(website !== undefined && { website: website.href }),
    ...(marker?.[1] !== undefined && { cmsEventId: marker[1] }),
  };
}

function reminder(name: string, url: string, provider: "luma" | "website"): string {
  const introduction = `Thanks for marking yourself interested in ${name} on Discord!`;
  return provider === "luma"
    ? `${introduction} To complete your RSVP, please register on Luma: ${url}`
    : `${introduction} To complete your RSVP, please RSVP on the events website: ${url}`;
}

export function rsvpReminder(deps: {
  readonly cms: Pick<CmsClient, "getEventLumaUrl">;
  readonly reporter: Reporter;
}) {
  return defineEvent({
    name: "rsvp-reminder",
    kind: "scheduledEventUserAdd",
    dedupKey: ({ event, user }) => `${event.id}:${user.id}`,
    handle: async ({ event, user }) => {
      if (event.guildId !== DISCORD_GUILD_ID) return Result.ok(undefined);

      return Result.tryPromise({
        try: async () => {
          const fullEvent = event.partial ? await event.fetch() : event;
          const links = rsvpLinks(fullEvent.description, fullEvent.entityMetadata?.location);
          let luma: string | undefined;
          let cmsLookupFailed = false;
          if (links.cmsEventId !== undefined) {
            const found = await deps.cms.getEventLumaUrl(links.cmsEventId);
            if (Result.isError(found)) {
              cmsLookupFailed = true;
              deps.reporter.emit({
                op: "rsvp-reminder.cms",
                status: "error",
                errorTag: tagOf(found.error),
                errorMessage: messageOf(found.error),
                attributes: { eventId: fullEvent.id },
              });
            } else {
              luma = found.value;
            }
          }
          // If the authoritative CMS read failed, the event page can still route
          // people correctly without guessing from incidental description links.
          if (!cmsLookupFailed) luma ??= links.luma;

          const target = luma ?? links.website ?? EVENTS_ORIGIN;
          const provider = luma === undefined ? "website" : "luma";
          // A member with closed DMs must not make the gateway listener fail.
          try {
            await user.send({
              content: reminder(fullEvent.name, target, provider),
              allowedMentions: { parse: [] },
            });
          } catch (cause) {
            if (!(cause instanceof DiscordAPIError && cause.code === 50_007)) throw cause;
            console.info(`Discord refused an RSVP DM to ${user.id} for event ${fullEvent.id}`);
          }
          return undefined;
        },
        catch: (cause) =>
          new Transient({ operation: "send Discord RSVP reminder", detail: messageOf(cause) }),
      });
    },
  });
}
