import type { Client } from "discord.js";
import type { Schedule } from "effect";

import { Effect } from "effect";

import { AppConfig } from "../config";
import { structuredError } from "../errors";
import {
    createHackNightThread,
    cleanupHackNightThread,
    hackNightCreateSchedule,
    hackNightCleanupSchedule,
} from "../features/hack-night";

interface CronJob {
    name: string;
    schedule: Schedule.Schedule<unknown, unknown>;
    handler: (client: Client) => Effect.Effect<void, unknown, unknown>;
    featureFlag?: string;
}

const cronJobs: CronJob[] = [
    {
        name: "hack-night-create",
        schedule: hackNightCreateSchedule,
        handler: createHackNightThread,
        featureFlag: "hackNightPhotos",
    },
    {
        name: "hack-night-cleanup",
        schedule: hackNightCleanupSchedule,
        handler: cleanupHackNightThread,
        featureFlag: "hackNightPhotos",
    },
];

export const startCronJobs = Effect.fn("Crons.startCronJobs")(function* (client: Client) {
    const startTime = Date.now();
    const config = yield* AppConfig;

    const allJobs = cronJobs;
    const enabledJobs = cronJobs.filter((job) => {
        if (job.featureFlag === "hackNightPhotos") {
            return config.HACK_NIGHT_PHOTOS_ENABLED;
        }
        return true;
    });

    const jobNames = enabledJobs.map((job) => job.name);

    yield* Effect.annotateCurrentSpan({
        total_jobs_count: allJobs.length,
        enabled_jobs_count: enabledJobs.length,
        disabled_jobs_count: allJobs.length - enabledJobs.length,
        job_names: jobNames.join(","),
        hack_night_photos_enabled: config.HACK_NIGHT_PHOTOS_ENABLED,
    });

    yield* Effect.logInfo("cron jobs initialization started", {
        total_jobs_count: allJobs.length,
        enabled_jobs_count: enabledJobs.length,
        disabled_jobs_count: allJobs.length - enabledJobs.length,
        job_names: jobNames.join(","),
        hack_night_photos_enabled: config.HACK_NIGHT_PHOTOS_ENABLED,
    });

    for (const job of enabledJobs) {
        const jobStartTime = Date.now();

        yield* Effect.logInfo("cron job starting", {
            cron_job_name: job.name,
            feature_flag: job.featureFlag ?? "none",
        });

        yield* job.handler(client).pipe(
            Effect.tap(() => {
                const jobDurationMs = Date.now() - jobStartTime;
                return Effect.logInfo("cron job execution completed", {
                    cron_job_name: job.name,
                    feature_flag: job.featureFlag ?? "none",
                    job_duration_ms: jobDurationMs,
                });
            }),
            Effect.catchAll((e) => {
                const jobDurationMs = Date.now() - jobStartTime;
                return Effect.logError("cron job execution failed", {
                    ...structuredError(e),
                    cron_job_name: job.name,
                    feature_flag: job.featureFlag ?? "none",
                    job_duration_ms: jobDurationMs,
                });
            }),
            Effect.withSpan("Crons.runJob", {
                attributes: {
                    cron_job_name: job.name,
                    feature_flag: job.featureFlag ?? "none",
                },
            }),
            Effect.schedule(job.schedule),
            Effect.forkDaemon,
        );

        const jobInitDurationMs = Date.now() - jobStartTime;

        yield* Effect.logDebug("cron job forked as daemon", {
            cron_job_name: job.name,
            feature_flag: job.featureFlag ?? "none",
            init_duration_ms: jobInitDurationMs,
        });
    }

    const totalDurationMs = Date.now() - startTime;

    yield* Effect.annotateCurrentSpan({
        total_duration_ms: totalDurationMs,
    });

    yield* Effect.logInfo("cron jobs initialization completed", {
        total_jobs_count: allJobs.length,
        enabled_jobs_count: enabledJobs.length,
        jobs_started_count: enabledJobs.length,
        total_duration_ms: totalDurationMs,
    });
});
