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

/** Links embedded in an event's description or external-event location. */
function rsvpLinks(description: string | null, location: string | null | undefined) {
  let luma: string | undefined;
  let website: URL | undefined;
  let eventPage: URL | undefined;
  let markedPage: URL | undefined;

  for (const match of `${description ?? ""}\n${location ?? ""}`.match(URL_PATTERN) ?? []) {
    const url = URL.parse(match.replace(TRAILING_PUNCTUATION, ""));
    if (url === null) continue;

    luma ??= lumaUrl(url.href);
    if (url.origin !== EVENTS_ORIGIN) continue;
    website ??= url;
    if (!url.pathname.startsWith("/events/")) continue;
    eventPage ??= url;
    // The sync appends its ID-marked event page after the description.
    if (CMS_MARKER.test(url.hash)) markedPage = url;
  }

  const chosen = markedPage ?? eventPage ?? website;
  const cmsEventId = CMS_MARKER.exec(chosen?.hash ?? "")?.[1];
  if (chosen !== undefined) chosen.hash = "";
  return { luma, website: chosen?.href, cmsEventId };
}

function reminder(name: string, url: string, provider: "luma" | "website"): string {
  let instruction = "please RSVP on our events website too:";
  if (provider === "luma") {
    instruction = "please RSVP on Luma too:";
  } else if (url === EVENTS_ORIGIN || url === `${EVENTS_ORIGIN}/`) {
    instruction = "find the event on our events website and RSVP there too:";
  }
  return (
    `Hey there, it looks like you're interested in **${name}** on Discord!! :D\n\n` +
    `You're almost there!! Discord's Interested button doesn't count as an RSVP, so ${instruction}\n\n` +
    `${url}\n\n` +
    "Cheers! ^•^"
  );
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
          let luma = links.luma;
          if (links.cmsEventId !== undefined) {
            const found = await deps.cms.getEventLumaUrl(links.cmsEventId);
            if (Result.isError(found)) {
              luma = undefined;
              deps.reporter.emit({
                op: "rsvp-reminder.cms",
                status: "error",
                errorTag: tagOf(found.error),
                errorMessage: messageOf(found.error),
                attributes: { eventId: fullEvent.id },
              });
            } else {
              luma = found.value ?? links.luma;
            }
          }

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
