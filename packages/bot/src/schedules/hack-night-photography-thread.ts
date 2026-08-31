/**
 * Friday 8 PM — open hack night.
 *
 * Posts an announcement, pins it, opens the photo thread, pings the role, and
 * records the drop so Sunday's cleanup can find the archive.
 *
 * The drop it records is unlinked: photos are filed under a date-derived batch
 * until an organizer runs `/hack-night start event:<slug>` to point tonight at a
 * CMS event.
 *
 * One subtlety carried over verbatim, because getting it wrong destroys the
 * announcement: pinning a message makes Discord emit a `ChannelPinnedMessage`
 * system notice in the channel, which is noise. Deleting it means finding *that*
 * message specifically — a naive "delete the most recent message" races the pin
 * and can wipe the announcement that was just posted.
 */

import { DISCORD_IDS } from "@repo/shared/discord";
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { MessageType, ThreadAutoArchiveDuration } from "discord.js";

import type { Schedule } from "../framework/schedules.ts";
import { HACK_NIGHT_THREAD_PREFIX, hackNightDrop } from "../integrations/image-drop.ts";
import type { ImageDropStore } from "../integrations/image-drop.ts";
import { calendarDate } from "../utils/dates.ts";

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
function threadDateLabel(date: Date): string {
  const { month, day } = calendarDate(date);
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

export function hackNightPhotographyThread(deps: { readonly drops: ImageDropStore }) {
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

          const greeting = ANNOUNCEMENTS[Math.floor(Math.random() * ANNOUNCEMENTS.length)];
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

          const today = new Date();
          const thread = await announcement.startThread({
            name: `${HACK_NIGHT_THREAD_PREFIX} - ${threadDateLabel(today)}`,
            autoArchiveDuration: THREAD_ARCHIVE_DURATION,
          });

          await thread.send(`(<@&${DISCORD_IDS.roles.HACK_NIGHT_PING}>)`);

          // Recorded last: the thread must exist before anything can be filed
          // against its batch.
          const stored = await deps.drops.set(thread.id, hackNightDrop(today));
          if (Result.isError(stored)) throw stored.error;
          return undefined;
        },
        catch: (cause) =>
          new Transient({
            operation: "open hack night",
            detail: messageOf(cause),
          }),
      }),
  } satisfies Schedule;
}
