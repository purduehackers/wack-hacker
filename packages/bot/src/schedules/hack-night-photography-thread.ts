/**
 * Friday 8 PM — open hack night.
 *
 * Posts an announcement, pins it, opens the photo thread, pings the role, and
 * records the event slug so Sunday's cleanup can find the archive.
 *
 * One subtlety carried over verbatim, because getting it wrong destroys the
 * announcement: pinning a message makes Discord emit a `ChannelPinnedMessage`
 * system notice in the channel, which is noise. Deleting it means finding *that*
 * message specifically — a naive "delete the most recent message" races the pin
 * and can wipe the announcement that was just posted.
 */

import { DISCORD_IDS } from "@repo/shared/discord";
import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { MessageType, ThreadAutoArchiveDuration } from "discord.js";

import type { Schedule } from "../framework/schedules.ts";
import { generateEventSlug } from "../integrations/hack-night.ts";
import type { ThreadSlugStore } from "../integrations/hack-night.ts";
import { indianaDate } from "../time/indiana.ts";

const ANNOUNCEMENTS = [
  "Happy Hack Night! :D",
  "Welcome to Hack Night! :D",
  "Hack Night is here! :D",
  "It's Hack Night! :D",
  "Hack Night is starting! :D",
  "Let's get hacking! :D",
  "Time to hack! :D",
  "Hack Night is live! :D",
  "Hack Night is a go! :D",
] as const;

/** The thread only needs to outlive the event. */
const THREAD_ARCHIVE_DURATION = ThreadAutoArchiveDuration.OneDay;

/** Enough to find the pin notice without scanning the channel. */
const PIN_NOTICE_LOOKBACK = 5;

/** `MM/DD`, matching the established thread naming so archives stay consistent. */
export function threadDateLabel(date: Date): string {
  const { month, day } = indianaDate(date);
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

export function hackNightPhotographyThread(deps: {
  readonly slugStore: ThreadSlugStore;
  readonly now?: () => Date;
  readonly random?: () => number;
}) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;

  return {
    name: "hack-night-photography-thread",
    // Friday at 20:00 local. The former cron said "0 0 * * 6" because Vercel
    // evaluates in UTC; running in-process with an explicit timezone means the
    // expression can say what it means.
    cron: "0 20 * * 5",
    run: async ({ client }) =>
      Result.tryPromise({
        try: async () => {
          const channel = await client.channels.fetch(DISCORD_IDS.channels.HACK_NIGHT);
          if (!channel?.isTextBased() || channel.isDMBased()) {
            throw new Error("hack night channel is not a guild text channel");
          }

          const greeting = ANNOUNCEMENTS[Math.floor(random() * ANNOUNCEMENTS.length)];
          const announcement = await channel.send(
            `${greeting} \u{1F389}\n\nShare your pictures from the night in this thread!`,
          );
          await announcement.pin();

          // Find the pin notice by type, never by recency.
          const recent = await channel.messages.fetch({ limit: PIN_NOTICE_LOOKBACK });
          const notice = recent.find(
            (candidate) =>
              candidate.type === MessageType.ChannelPinnedMessage &&
              candidate.id !== announcement.id,
          );
          if (notice !== undefined) await notice.delete();

          const today = now();
          const thread = await announcement.startThread({
            name: `Hack Night Images - ${threadDateLabel(today)}`,
            autoArchiveDuration: THREAD_ARCHIVE_DURATION,
          });

          await thread.send(`(<@&${DISCORD_IDS.roles.HACK_NIGHT_PING}>)`);

          // Recorded last: the thread must exist before anything can be filed
          // against its slug.
          const stored = await deps.slugStore.set(thread.id, generateEventSlug(today));
          if (Result.isError(stored)) throw stored.error;
          return undefined;
        },
        catch: (cause) =>
          new Transient({
            operation: "open hack night",
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
  } satisfies Schedule;
}
