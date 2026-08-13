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
import { messageOf, Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Client } from "discord.js";

import type { Schedule } from "../framework/schedules.ts";
import { nextMidnight, wallClockDate } from "../utils/dates.ts";

const lightning = new LightningTime();

/** 16 bolts × 16 zaps × 16 sparks = 4096 sparks in a day, so 21093.75 ms each. */
const SPARK_MS = 86_400_000 / (16 * 16 * 16);

/**
 * Current Lightning Time, for example `f~f~a|4`.
 *
 * Via `wallClockDate` because the library reads local component getters off the
 * Date it is given: the process runs in UTC, so a raw instant would render UTC's
 * Lightning Time and the countdown would never roll over to `0~0~0|0`.
 */
function lightningNow(at: Date): string {
  return lightning.convertToLightning(wallClockDate(at)).lightningString;
}

/**
 * The heads-up, posted two minutes out.
 *
 * No role ping on purpose: the Friday announcement already pings
 * `HACK_NIGHT_PING`, and twice in one evening is how a role gets muted.
 */
const UPCOMING_MESSAGE = "countdown is in two minutes!! ⚡⚡";

/**
 * The live message during the countdown.
 *
 * The second line is the clock as it actually reads, not a fixed label: it
 * starts at `f~f~f|0`, ticks up through `f~f~f|f`, and lands on `0~0~0|0`. That
 * ticking *is* the countdown, which is why this message is re-edited on every
 * charge rather than written once.
 */
function happeningMessage(at: Date): string {
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
 *
 * Counted backwards from the next Indiana midnight rather than via
 * `convertFromLightning`, which truncates to whole seconds and so returns
 * 23:59:38.000 — nine hundred milliseconds early, while the clock still reads
 * `f~f~e|f`. Deriving from that midnight also stays correct across a DST
 * boundary, where the day is not 24 hours long.
 *
 * Each boundary is rounded *up*: a spark is 21093.75 ms, so it falls on a
 * quarter millisecond that `Date` cannot represent. Truncating would land at
 * 23:59:38.906, a hair before the spark, where the clock still reads
 * `f~f~e|f`. Ceiling lands on 23:59:38.907, the first millisecond that actually
 * reads `f~f~f|0`.
 */
function countdownTicks(at: Date): readonly Date[] {
  const midnight = nextMidnight(at);
  const sparkStart = midnight.getTime() - SPARK_MS;

  const ticks: Date[] = [];
  for (let charge = 0; charge < CHARGES_PER_SPARK; charge += 1) {
    ticks.push(new Date(Math.ceil(sparkStart + charge * CHARGE_MS)));
  }
  // The payoff: 0~0~0|0.
  ticks.push(midnight);
  return ticks;
}

/**
 * Ceiling on how far ahead of a boundary an edit may be sent.
 *
 * A quarter of a charge. Beyond that a slow measurement would have us rendering
 * the next value well before the previous one stopped being true.
 */
const MAX_LEAD_MS = CHARGE_MS / 4;

/**
 * How far ahead of each boundary to send, so the edit *lands* on the beat
 * rather than a round trip after it.
 *
 * Measured once and then held constant for the whole countdown. An earlier
 * version re-estimated it after every edit with a moving average, and that was
 * measurably worse: round-trip time to Discord is jitter, not a trend, so
 * chasing it adds the variance of the estimate on top of the variance of the
 * network — roughly doubling the spread in when frames actually land. A live
 * run showed one 1037ms request inflate the lead to 607ms, which then fired the
 * next two frames 201ms and 261ms early.
 *
 * Even spacing matters more than absolute alignment here. A clock that is
 * uniformly a little late still reads as a smooth countdown; one that is
 * centred but jittery reads as skipping.
 */
function leadFrom(samplesMs: readonly number[]): number {
  const usable = samplesMs.filter((sample) => Number.isFinite(sample) && sample >= 0);
  if (usable.length === 0) return 0;

  // Median, not mean: one slow sample should not shift the estimate, and with
  // three probes the median is simply the middle one.
  const sorted = [...usable].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return Math.min(median, MAX_LEAD_MS);
}

/** How many latency probes to take before the countdown starts. */
const LEAD_SAMPLES = 3;
const LEAD_SAMPLE_GAP_MS = 250;

/** How long before the first charge to start probing. Covers the probe run. */
const LEAD_WARMUP_MS = 2_000;

const now = () => new Date();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Measures round-trip time to Discord's REST API, and warms the connection.
 *
 * Both jobs matter, and the timing is what makes them work. This runs in the
 * couple of seconds *before* the first charge, not right after the heads-up
 * post, for two reasons drawn from live runs:
 *
 * - The first request of a run pays for connection setup. Measuring the post
 *   gave 330ms against a 180ms steady state, which left every frame landing
 *   about 140ms early.
 * - Roughly a hundred seconds pass between the heads-up and the first charge,
 *   which is far longer than undici's idle keep-alive. Without a probe run
 *   immediately beforehand, the first edit pays for a fresh connection and
 *   arrives noticeably late — the one frame nobody wants late.
 *
 * `GET /users/@me` has no side effects and travels the same path as the edits
 * it stands in for. It is a read, and writes cost a little more, so the
 * estimate runs slightly short and frames land a touch late rather than early.
 * That is the better direction to miss in: uniformly late reads as smooth,
 * early reads as the clock jumping ahead of itself.
 */
async function measureLead(rest: Pick<Client["rest"], "get">): Promise<number> {
  const samples: number[] = [];

  for (let probe = 0; probe < LEAD_SAMPLES; probe += 1) {
    const startedAt = now().getTime();
    try {
      await rest.get("/users/@me");
      samples.push(now().getTime() - startedAt);
    } catch {
      // A failed probe tells us nothing about latency; the median covers it.
    }
    if (probe < LEAD_SAMPLES - 1) await sleep(LEAD_SAMPLE_GAP_MS);
  }

  return leadFrom(samples);
}

export function hackNightCountdown() {
  return {
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

          const schedule = countdownTicks(now());
          const firstTick = schedule[0];
          if (firstTick === undefined) throw new Error("countdown produced no ticks");

          // Idle out the ninety-odd seconds, then probe just before the first
          // charge — which both measures latency and warms the connection that
          // the ninety seconds of silence let go cold.
          const untilWarmup = firstTick.getTime() - LEAD_WARMUP_MS - now().getTime();
          if (untilWarmup > 0) await sleep(untilWarmup);

          const lead = await measureLead(client.rest);

          // Absolute instants, so a slow edit shortens the next wait instead of
          // pushing the whole countdown late. The cron fires on the minute; the
          // first tick is at 23:59:38.907.
          for (const tick of schedule) {
            // Send early by the measured round trip so the edit *lands* on the
            // boundary. Waiting until the boundary and then sending puts every
            // frame a round trip behind the clock it is displaying.
            const waitMs = tick.getTime() - lead - now().getTime();
            if (waitMs > 0) await sleep(waitMs);

            try {
              // Rendered for `tick`, not for the send time: the content is what
              // the clock will read when the edit arrives.
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
            detail: messageOf(cause),
          }),
      }),
  } satisfies Schedule;
}
