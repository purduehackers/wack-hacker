/**
 * Countdown — the rollover into a new Lightning Time day.
 *
 * Purdue Hackers keeps time in [Lightning Time][1]: the day is split into 16
 * bolts, each into 16 zaps, each into 16 sparks, each into 16 charges, written
 * `bolts~zaps~sparks|charges`. Every unit is a single hex digit, so a day runs
 * from `0~0~0|0` to `f~f~f|f` and back.
 *
 * Countdown is the last spark of the day. At `f~f~f|0` the charges begin ticking
 * `0` → `f` — sixteen of them, about 21 seconds — and then the clock rolls over
 * to `0~0~0|0`. That is the moment everyone counts down to, in hex rather than
 * the usual ten.
 *
 * This job posts a heads-up two minutes out, then edits that same message when
 * the final spark actually starts, so the channel does not accumulate two posts
 * for one event.
 *
 * [1]: https://blog.purduehackers.com/posts/lightning-time
 */

import { LightningTime } from "@purduehackers/time";
import { DISCORD_IDS } from "@repo/shared/discord";
import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";

import { defineSchedule } from "../framework/schedules.ts";

const lightning = new LightningTime();

/** The final spark of the day: the instant charges start ticking toward zero. */
export const FINAL_SPARK = "f~f~f|0";

/** 16 bolts × 16 zaps × 16 sparks = 4096 sparks in a day, so 21093.75 ms each. */
const SPARK_MS = 86_400_000 / (16 * 16 * 16);

/**
 * When the final spark begins, in local time.
 *
 * Computed backwards from the next local midnight rather than via
 * `convertFromLightning(FINAL_SPARK)`, which truncates to whole seconds and so
 * returns 23:59:38.000 — nine hundred milliseconds early, while the clock still
 * reads `f~f~e|f`. Editing the message before the spark it announces has
 * actually begun is exactly the sort of off-by-a-bit that makes a countdown
 * feel wrong.
 *
 * Deriving from local midnight also keeps it correct across a DST boundary,
 * where the day is not 24 hours long.
 *
 * Rounded *up*: a spark is 21093.75 ms, so the boundary falls on a quarter
 * millisecond that `Date` cannot represent. Truncating would land at
 * 23:59:38.906, a hair before the spark, where the clock still reads
 * `f~f~e|f`. Ceiling lands on 23:59:38.907, the first millisecond that actually
 * reads `f~f~f|0`.
 */
export function finalSparkAt(at: Date): Date {
  const midnight = new Date(at);
  midnight.setHours(24, 0, 0, 0);
  return new Date(Math.ceil(midnight.getTime() - SPARK_MS));
}

/** Current Lightning Time, for example `f~f~a|4`. */
export function lightningNow(at: Date): string {
  return lightning.convertToLightning(at).lightningString;
}

/**
 * The heads-up, posted two minutes out.
 *
 * No role ping on purpose: the Friday announcement already pings
 * `HACK_NIGHT_PING`, and twice in one evening is how a role gets muted.
 */
export function upcomingMessage(at: Date): string {
  return [
    "**countdown** in two minutes!! ⚡",
    "",
    `it's \`${lightningNow(at)}\` — once we hit \`${FINAL_SPARK}\` the charges tick`,
    "`0` → `f` and then it's a whole new day :D",
  ].join("\n");
}

/** The edit, once the final spark has actually started. */
export function happeningMessage(): string {
  return [
    "**countdown is happening!!** ⚡⚡",
    "",
    `\`${FINAL_SPARK}\` → \`0~0~0|0\``,
    "",
    "count 'em down!! :D",
  ].join("\n");
}

export interface CountdownDeps {
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

export function hackNightCountdown(deps: CountdownDeps = {}) {
  const now = deps.now ?? (() => new Date());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return defineSchedule({
    name: "hack-night-countdown",
    // 23:58 on hack night. Two minutes before midnight, which is two minutes
    // before Lightning Time rolls over to 0~0~0|0.
    cron: "58 23 * * 5",
    run: async ({ client }) =>
      Result.tryPromise({
        try: async () => {
          const channel = await client.channels.fetch(DISCORD_IDS.channels.HACK_NIGHT);
          if (!channel?.isTextBased() || channel.isDMBased()) {
            throw new Error("hack night channel is not a guild text channel");
          }

          const posted = await channel.send(upcomingMessage(now()));

          // Wait for the final spark rather than assuming two minutes exactly:
          // the cron fires on the minute, the spark starts at 23:59:38.9.
          const waitMs = finalSparkAt(now()).getTime() - now().getTime();
          if (waitMs > 0) await sleep(waitMs);

          // If the process restarts during the wait the edit is simply lost,
          // leaving the heads-up in place. That is the right failure for a
          // cosmetic message — better a stale "in two minutes" than a duplicate.
          await posted.edit(happeningMessage());
          return undefined;
        },
        catch: (cause) =>
          new Transient({
            operation: "post countdown",
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
  });
}
