/** Once-a-minute durable dispatcher for application-managed schedules. */

import { messageOf, Transient, UpstreamError } from "@repo/shared/errors";
import { getRedis } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { BOT_ROUTES } from "@repo/shared/wire";
import type { ScheduledFirePayload } from "@repo/shared/wire";
import { defineSchedule } from "eve/schedules";

import { env } from "../env.ts";
import { resolveBotBaseUrl } from "../lib/bot/endpoint.ts";
import { getScheduleStore, SCHEDULE_MAX_ATTEMPTS } from "../lib/schedule/store.ts";
import type { ClaimedSchedule, ScheduleStore, ScheduleStoreError } from "../lib/schedule/store.ts";
import {
  countAgentEvent,
  currentTraceparent,
  logAgentEvent,
  traceHeaders,
} from "../lib/telemetry.ts";

const CLAIM_LIMIT = 25;
const LEASE_FOR_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const redis = getRedis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

function desiredFire(job: ClaimedSchedule): ScheduledFirePayload {
  const traceparent = currentTraceparent();
  return {
    scheduleId: job.id,
    occurrenceId: job.occurrenceId,
    ownerId: job.ownerId,
    channelId: job.channelId,
    description: job.description,
    actionType: job.actionType,
    prompt: job.prompt,
    ...(job.memberRoles === undefined ? {} : { memberRoles: job.memberRoles }),
    attemptNumber: job.attemptCount + 1,
    finalAttempt: job.attemptCount + 1 >= SCHEDULE_MAX_ATTEMPTS,
    ...(traceparent === undefined ? {} : { traceparent }),
    scheduledFor: job.nextRunAt,
  };
}

async function postToBot(job: ClaimedSchedule): Promise<Result<void, Transient | UpstreamError>> {
  return Result.tryPromise({
    try: async () => {
      const botUrl = await resolveBotBaseUrl(redis, env.BOT_URL);
      const payload = desiredFire(job);
      const response = await fetch(new URL(BOT_ROUTES.scheduled, botUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.BOT_INGRESS_SECRET}`,
          ...traceHeaders(payload.traceparent),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (!response.ok) {
        throw new UpstreamError({
          service: "bot",
          status: response.status,
          detail: "scheduled occurrence was rejected",
        });
      }
    },
    catch: (cause) =>
      UpstreamError.is(cause)
        ? cause
        : new Transient({
            operation: "deliver scheduled occurrence",
            detail: messageOf(cause),
          }),
  });
}

function settlementFailure(job: ClaimedSchedule, error: unknown): void {
  // The lease expires, so a later minute tick can recover even when the
  // database was unreachable while recording this retry.
  countAgentEvent("agent.schedule.dispatch", {
    status: "settlement_failed",
    actionType: job.actionType,
  });
  logAgentEvent(
    "schedule.dispatch.settlement_failed",
    {
      scheduleId: job.id,
      occurrenceId: job.occurrenceId,
      errorType: error instanceof Error ? error.name : "unknown",
    },
    "error",
  );
}

async function settleFailedDelivery(
  scheduleStore: ScheduleStore,
  job: ClaimedSchedule,
  deliveryError: ScheduleStoreError | UpstreamError,
): Promise<void> {
  // The task view is user-visible. Persist only a stable public reason; the
  // failure class and trace retain the operational diagnosis.
  const attempted = await Result.tryPromise({
    try: () => scheduleStore.fail(job, "scheduled delivery failed"),
    catch: (cause) => cause,
  });
  if (Result.isError(attempted)) {
    settlementFailure(job, attempted.error);
    return;
  }
  const settlement = attempted.value;
  if (Result.isError(settlement)) {
    settlementFailure(job, settlement.error);
    return;
  }

  const outcome = settlement.value;
  countAgentEvent("agent.schedule.dispatch", {
    status: outcome.terminal ? "terminal" : "retry",
    actionType: job.actionType,
    settled: outcome.settled,
  });
  const event = JSON.stringify({
    event: "schedule.dispatch.failed",
    scheduleId: job.id,
    occurrenceId: job.occurrenceId,
    attemptCount: outcome.attemptCount,
    terminal: outcome.terminal,
    settled: outcome.settled,
    errorType: deliveryError instanceof Error ? deliveryError.name : "unknown",
  });
  if (outcome.terminal) console.error(event);
  else console.warn(event);
  if (!outcome.settled) {
    console.info(`scheduled occurrence ${job.occurrenceId} lost its failure lease`);
  }
}

async function dispatchOne(job: ClaimedSchedule): Promise<void> {
  const scheduleStore = await getScheduleStore();
  const delivered = await postToBot(job);
  if (Result.isError(delivered)) {
    await settleFailedDelivery(scheduleStore, job, delivered.error);
    return;
  }

  const completion = await scheduleStore.complete(job);
  if (Result.isError(completion)) {
    await settleFailedDelivery(scheduleStore, job, completion.error);
    return;
  }

  countAgentEvent("agent.schedule.dispatch", {
    status: completion.value ? "completed" : "lease_lost",
    actionType: job.actionType,
  });
  logAgentEvent("schedule.dispatch.completed", {
    scheduleId: job.id,
    occurrenceId: job.occurrenceId,
    settled: completion.value,
  });
}

async function dispatchDue(): Promise<Result<void, ScheduleStoreError>> {
  const result = await Result.gen(async function* () {
    const scheduleStore = yield* Result.await(
      Result.tryPromise({
        try: getScheduleStore,
        catch: (cause) =>
          new Transient({
            operation: "initialize schedule store",
            detail: messageOf(cause),
          }),
      }),
    );
    const jobs = yield* Result.await(
      scheduleStore.claimDue({
        now: new Date(),
        limit: CLAIM_LIMIT,
        leaseForMs: LEASE_FOR_MS,
      }),
    );
    if (jobs.length > 0) countAgentEvent("agent.schedule.claimed", {}, jobs.length);
    await Promise.all(jobs.map(dispatchOne));
    return Result.ok(undefined);
  });

  countAgentEvent("agent.schedule.tick", {
    status: Result.isOk(result) ? "completed" : "failed",
  });
  return result;
}

export default defineSchedule({
  cron: "* * * * *",
  run({ waitUntil }) {
    waitUntil(dispatchDue().then((result) => result.unwrap("dispatch due scheduled tasks")));
  },
});
