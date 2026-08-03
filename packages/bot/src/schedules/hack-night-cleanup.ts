/**
 * Sunday 6 PM — close out hack night.
 *
 * Counts the photos, posts a top-five photographer leaderboard, then archives and
 * locks the thread.
 *
 * The thread is archived on *every* path, including when no photos were found.
 * The legacy version did the same, and it matters: a thread left open collects
 * stray messages all week and the next Friday's job then has two candidate
 * threads to choose between.
 */

import { DISCORD_IDS } from "@repo/shared/discord";
import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";

import { defineSchedule } from "../framework/schedules.ts";
import { rankPhotographers } from "../integrations/cms.ts";
import type { CmsClient, HackNightImage } from "../integrations/cms.ts";
import { fridayOf, resolveEventSlug } from "../integrations/hack-night.ts";
import type { ThreadSlugStore } from "../integrations/hack-night.ts";

/** Enough to find the thread-bearing announcement from the last event. */
const ANNOUNCEMENT_LOOKBACK = 10;

const LEADERBOARD_SIZE = 5;

export function leaderboardMessage(images: readonly HackNightImage[]): string | undefined {
  const ranked = rankPhotographers(images).slice(0, LEADERBOARD_SIZE);
  if (ranked.length === 0) return undefined;

  const rows = ranked
    .map((entry, index) => `${index + 1}. <@${entry.userId}> — ${entry.count} photos`)
    .join("\n");
  return `**Top Photographers:**\n${rows}`;
}

export function hackNightCleanup(deps: {
  readonly slugStore: ThreadSlugStore;
  readonly cms: CmsClient;
  readonly now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  return defineSchedule({
    name: "hack-night-cleanup",
    cron: "0 18 * * 0",
    run: async ({ client }) =>
      Result.tryPromise({
        try: async () => {
          const channel = await client.channels.fetch(DISCORD_IDS.channels.HACK_NIGHT);
          if (!channel?.isTextBased() || channel.isDMBased()) {
            throw new Error("hack night channel is not a guild text channel");
          }

          const recent = await channel.messages.fetch({ limit: ANNOUNCEMENT_LOOKBACK });
          const thread = recent.find((message) => message.thread !== undefined)?.thread;
          if (!thread) {
            console.info("no active hack night thread; nothing to clean up");
            return undefined;
          }

          // Sunday, so the slug belongs to Friday. A stored slug wins, because a
          // hack night that ran past midnight is dated to when it started.
          const slug = await resolveEventSlug(deps.slugStore, thread.id, fridayOf(now()));

          const listed = await deps.cms.listImages(slug);
          const images = Result.isError(listed) ? [] : listed.value;
          if (Result.isError(listed)) {
            console.warn(`could not list photos for ${slug}; closing the thread anyway`);
          }

          if (images.length > 0) {
            await channel.send(
              `Thanks for coming to Hack Night! ${images.length} photos were taken.`,
            );

            const leaderboard = leaderboardMessage(images);
            if (leaderboard !== undefined) await channel.send(leaderboard);

            await channel.send("Happy hacking, and see you next time! :D");
          }

          // Always, even with no photos: an open thread collects stray messages
          // and leaves next Friday's job with two candidate threads.
          await thread.setArchived(true);
          await thread.setLocked(true);
          return undefined;
        },
        catch: (cause) =>
          new Transient({
            operation: "close hack night",
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
  });
}
