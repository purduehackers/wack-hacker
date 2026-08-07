/**
 * In-process scheduled community jobs.
 *
 * Croner evaluates every expression in Indiana time. Sandbox replacement may
 * briefly overlap processes, so Redis claims each nominal occurrence before any
 * side effect and retains the claim beyond the weekly interval.
 */

import { Transient } from "@repo/shared/errors";
import type { KnownError } from "@repo/shared/errors";
import type { RedisClient } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { instrument } from "@repo/shared/result/observe";
import type { Reporter } from "@repo/shared/result/observe";
import { Cron } from "croner";
import type { Client } from "discord.js";

import { indianaMinuteId } from "../time/indiana.ts";
import { traceOperation } from "./observability.ts";

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
  readonly redis: RedisClient;
  readonly now?: () => Date;
}

export interface RunningScheduler {
  /** Stops every job. Safe to call more than once. */
  readonly stop: () => void;
  /** Next fire time per job, for logging at startup. */
  readonly nextRuns: ReadonlyMap<string, Date | undefined>;
}

const SCHEDULE_CLAIM_TTL_SECONDS = 14 * 24 * 60 * 60;

export async function claimScheduleFire(
  redis: RedisClient,
  scheduleName: string,
  at: Date,
): Promise<Result<boolean, Transient>> {
  return Result.tryPromise({
    try: async () =>
      (await redis.set(`bot:schedule:${scheduleName}:${indianaMinuteId(at)}`, "1", {
        nx: true,
        ex: SCHEDULE_CLAIM_TTL_SECONDS,
      })) === "OK",
    catch: (cause) =>
      new Transient({
        operation: `claim schedule ${scheduleName}`,
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  });
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
        const op = `schedule.${schedule.name}`;
        await traceOperation(
          op,
          () =>
            instrument(op, deps.reporter, async () => {
              const claimed = await claimScheduleFire(
                deps.redis,
                schedule.name,
                (deps.now ?? (() => new Date()))(),
              );
              if (Result.isError(claimed)) return claimed;
              if (!claimed.value) return Result.ok(undefined);
              const ran = await Result.tryPromise({
                try: () => schedule.run({ client: deps.client }),
                catch: (cause) => cause,
              });
              return Result.isError(ran) ? Result.err(ran.error) : ran.value;
            }),
          { "schedule.name": schedule.name },
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
