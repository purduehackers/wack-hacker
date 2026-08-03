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
export const UPCOMING_MESSAGE = "countdown is in two minutes!! ⚡⚡";

/**
 * The live message during the countdown.
 *
 * The second line is the clock as it actually reads, not a fixed label: it
 * starts at `f~f~f|0`, ticks up through `f~f~f|f`, and lands on `0~0~0|0`. That
 * ticking *is* the countdown, which is why this message is re-edited on every
 * charge rather than written once.
 */
export function happeningMessage(at: Date): string {
  return `**countdown is happening!!** ⚡⚡\n\`${lightningNow(at)}\``;
}

/** A charge is a sixteenth of a spark: 1318.359375 ms. */
const CHARGE_MS = SPARK_MS / 16;

/** 16 charges tick during the final spark, then the day rolls over. */
const CHARGES_PER_SPARK = 16;

/**
 * Every instant the message should be re-rendered: each of the 16 charge
 * boundaries in the final spark, then midnight itself.
 *
 * Absolute instants rather than repeated fixed sleeps, so a slow edit cannot
 * make the clock drift behind the real time it is displaying.
 */
export function countdownTicks(at: Date): readonly Date[] {
  const midnight = new Date(at);
  midnight.setHours(24, 0, 0, 0);
  const sparkStart = midnight.getTime() - SPARK_MS;

  const ticks: Date[] = [];
  for (let charge = 0; charge < CHARGES_PER_SPARK; charge += 1) {
    ticks.push(new Date(Math.ceil(sparkStart + charge * CHARGE_MS)));
  }
  // The payoff: 0~0~0|0.
  ticks.push(midnight);
  return ticks;
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

          const posted = await channel.send(UPCOMING_MESSAGE);

          // Absolute instants, so a slow edit shortens the next wait instead of
          // pushing the whole countdown late. The cron fires on the minute; the
          // first tick is at 23:59:38.907.
          for (const tick of countdownTicks(now())) {
            const waitMs = tick.getTime() - now().getTime();
            if (waitMs > 0) await sleep(waitMs);

            try {
              await posted.edit(happeningMessage(tick));
            } catch (cause) {
              // A dropped or rate-limited edit loses one frame. Abandoning the
              // countdown over it would leave the message frozen mid-tick, so
              // keep going and let the next charge catch up.
              console.warn("countdown edit failed", cause);
            }
          }
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
