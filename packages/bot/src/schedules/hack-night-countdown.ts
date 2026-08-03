/**
 * Thursday 8 PM — remind the server that hack night is tomorrow.
 *
 * NOTE: this job has no equivalent in the legacy app. The filename came from the
 * migration sketch with no implementation behind it, so the behaviour below is
 * invented: a single reminder 24 hours ahead, in the hack night channel, without
 * pinging the role. It is deliberately the least surprising thing a job called
 * "countdown" could do.
 *
 * Two questions worth settling before treating this as final: whether it should
 * fire more than once (a real countdown might be T-24h and T-1h), and whether it
 * should ping `HACK_NIGHT_PING`. Pinging was left off because the Friday
 * announcement already does, and two pings a week for one event is how a role
 * gets muted.
 */

import { DISCORD_IDS } from "@repo/shared/discord";
import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";

import { defineSchedule } from "../framework/schedules.ts";

export const hackNightCountdown = defineSchedule({
  name: "hack-night-countdown",
  // Thursday at 20:00 local — 24 hours before the Friday announcement.
  cron: "0 20 * * 4",
  run: async ({ client }) =>
    Result.tryPromise({
      try: async () => {
        const channel = await client.channels.fetch(DISCORD_IDS.channels.HACK_NIGHT);
        if (!channel?.isTextBased() || channel.isDMBased()) {
          throw new Error("hack night channel is not a guild text channel");
        }

        await channel.send(
          "Hack Night is **tomorrow** at 8 PM! \u{1F319} Bring whatever you're working on.",
        );
        return undefined;
      },
      catch: (cause) =>
        new Transient({
          operation: "post hack night countdown",
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
    }),
});
