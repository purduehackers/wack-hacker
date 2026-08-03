/**
 * Scheduled jobs, run in-process.
 *
 * The legacy app could not hold a timer, so each job was a Vercel Cron hitting
 * `GET /api/crons/:name` behind a `CRON_SECRET`, with `buildCronRoutes()`
 * generating the schedule table at build time. A single always-on process needs
 * none of that: `croner` fires the callback directly.
 *
 * Because there is exactly one instance, there is also no coordination problem —
 * no lease, no "did another worker already run this minute" check. That
 * assumption is worth stating because it is the one thing that breaks if the bot
 * is ever scaled to two replicas: every job would fire twice.
 *
 * Timezone is explicit rather than inherited from the host. Hack night is a
 * Friday-evening event in Indiana, and a container defaulting to UTC would
 * announce it on the wrong day.
 */

import type { KnownError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { instrument } from "@repo/shared/result/observe";
import type { Reporter } from "@repo/shared/result/observe";
import { Cron } from "croner";
import type { Client } from "discord.js";

/** Purdue Hackers is in Indiana; every schedule below is local to it. */
export const SCHEDULE_TIMEZONE = "America/Indiana/Indianapolis";

export interface ScheduleContext {
  readonly client: Client<true>;
}

export interface Schedule {
  readonly name: string;
  /** Five-field cron expression, evaluated in `SCHEDULE_TIMEZONE`. */
  readonly cron: string;
  readonly run: (context: ScheduleContext) => Promise<Result<void, KnownError>>;
}

export function defineSchedule(schedule: Schedule): Schedule {
  return schedule;
}

export interface SchedulerDeps {
  readonly schedules: readonly Schedule[];
  readonly client: Client<true>;
  readonly reporter: Reporter;
}

export interface RunningScheduler {
  /** Stops every job. Safe to call more than once. */
  readonly stop: () => void;
  /** Next fire time per job, for logging at startup. */
  readonly nextRuns: ReadonlyMap<string, Date | undefined>;
}

export function startScheduler(deps: SchedulerDeps): RunningScheduler {
  const jobs = deps.schedules.map((schedule) => {
    const job = new Cron(
      schedule.cron,
      {
        name: schedule.name,
        timezone: SCHEDULE_TIMEZONE,
        // A job that overruns its interval must not stack up a second copy.
        protect: true,
        // croner would otherwise swallow a throw; everything is reported.
        catch: (cause: unknown) => {
          deps.reporter.captureDefect(cause, { op: `schedule.${schedule.name}` });
        },
      },
      async () => {
        await instrument(`schedule.${schedule.name}`, deps.reporter, () =>
          Result.tryPromise({
            try: () => schedule.run({ client: deps.client }),
            catch: (cause) => cause,
          }).then((settled) =>
            Result.isError(settled) ? Result.err(settled.error) : settled.value,
          ),
        );
      },
    );

    return { schedule, job };
  });

  const nextRuns = new Map(
    jobs.map(({ schedule, job }) => [schedule.name, job.nextRun() ?? undefined]),
  );

  return {
    stop: () => {
      for (const { job } of jobs) job.stop();
    },
    nextRuns,
  };
}
