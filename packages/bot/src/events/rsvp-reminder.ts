/** A Discord event subscription still needs a registration on the event's RSVP site. */

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { messageOf, tagOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import { RESTJSONErrorCodes } from "discord-api-types/v10";
import { DiscordAPIError } from "discord.js";

import { defineEvent } from "../framework/events.ts";
import { lumaUrl } from "../integrations/cms.ts";
import type { CmsClient } from "../integrations/cms.ts";

const EVENTS_ORIGIN = "https://events.purduehackers.com";
const URL_PATTERN = /https?:\/\/[^\s<>]+/giu;
const TRAILING_PUNCTUATION = /[)\].,!?;]+$/u;
const CMS_MARKER = /^#cms-event-(.+)$/iu;

function cmsEventId(hash: string): string | undefined {
  const encoded = CMS_MARKER.exec(hash)?.[1];
  if (encoded === undefined) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

/** Prefer the website sync's marked page over incidental description links. */
function rsvpLinks(description: string | null, location: string | null | undefined) {
  // The sync writes a marked URL on its own line. Keep the last such line when
  // someone adds notes after the footer, without trimming a valid ID suffix.
  let markedPage: URL | undefined;
  let markedId: string | undefined;
  for (const line of (description ?? "").split("\n")) {
    const url = URL.parse(line.trim());
    if (url?.origin !== EVENTS_ORIGIN || !url.pathname.startsWith("/events/")) continue;
    const id = cmsEventId(url.hash);
    if (id === undefined) continue;
    markedPage = url;
    markedId = id;
  }
  if (markedPage !== undefined) {
    markedPage.hash = "";
    return { luma: undefined, website: markedPage.href, cmsEventId: markedId };
  }

  let luma: string | undefined;
  let website: URL | undefined;
  let eventPage: URL | undefined;

  for (const match of `${description ?? ""}\n${location ?? ""}`.match(URL_PATTERN) ?? []) {
    const url = URL.parse(match.replace(TRAILING_PUNCTUATION, ""));
    if (url === null) continue;

    luma ??= lumaUrl(url.href);
    if (url.origin !== EVENTS_ORIGIN) continue;
    website ??= url;
    if (!url.pathname.startsWith("/events/")) continue;
    eventPage ??= url;
  }

  const chosen = eventPage ?? website;
  if (chosen !== undefined) chosen.hash = "";
  return {
    luma,
    website: chosen?.href,
    cmsEventId: undefined,
  };
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

          const target = luma ?? links.website ?? EVENTS_ORIGIN;
          const provider = luma === undefined ? "website" : "luma";
          // Expected DM refusals must not make the gateway listener fail.
          try {
            await user.send({
              content: reminder(fullEvent.name, target, provider),
              allowedMentions: { parse: [] },
            });
          } catch (cause) {
            if (
              !(cause instanceof DiscordAPIError) ||
              (cause.code !== RESTJSONErrorCodes.CannotSendMessagesToThisUser &&
                cause.code !==
                  RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds)
            ) {
              throw cause;
            }
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
