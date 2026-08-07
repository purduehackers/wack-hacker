#!/usr/bin/env bun

import { createClient } from "@libsql/client";
import { Redis } from "@upstash/redis";

const ACTIVE_GENERATION_KEY = "wack:bot-sandbox:active:v1";
const SUPERVISOR_MUTEX_KEY = "wack:bot-sandbox:supervisor:v1";

function usage(): never {
  console.error(`usage:
  bun packages/shared/scripts/ops-inspect.ts redis [--continuation <key>] [--dispatch <id>]
  bun packages/shared/scripts/ops-inspect.ts schedules`);
  process.exit(2);
}

function option(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) usage();
  return value;
}

function summary(raw: unknown, fields: readonly string[]): unknown {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { present: true, malformed: true };
    }
  }
  if (typeof value !== "object" || value === null) {
    return { present: value !== undefined && value !== null };
  }
  return Object.fromEntries(
    fields.flatMap((fieldName) => {
      const candidate = Reflect.get(value, fieldName);
      return candidate === undefined ? [] : [[fieldName, candidate]];
    }),
  );
}

async function inspectRedis(arguments_: readonly string[]): Promise<void> {
  const allowed = new Set(["--continuation", "--dispatch"]);
  for (let index = 0; index < arguments_.length; index += 2) {
    if (!allowed.has(arguments_[index] ?? "") || arguments_[index + 1] === undefined) usage();
  }
  const continuation = option(arguments_, "--continuation");
  const dispatch = option(arguments_, "--dispatch");
  if (continuation !== undefined && (continuation.length > 256 || /[\r\n]/u.test(continuation))) {
    throw new Error("continuation key is invalid");
  }
  if (dispatch !== undefined && !/^[A-Za-z0-9_-]{1,128}$/u.test(dispatch)) {
    throw new Error("dispatch id is invalid");
  }

  const url = process.env["UPSTASH_REDIS_REST_URL"];
  const token = process.env["UPSTASH_REDIS_REST_TOKEN"];
  if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL and token are required");
  const redis = new Redis({ url, token });

  const [active, mutexExists, mutexTtlMs, queueCount, readyCount, renderReadyCount] =
    await Promise.all([
      redis.get(ACTIVE_GENERATION_KEY),
      redis.exists(SUPERVISOR_MUTEX_KEY),
      redis.pttl(SUPERVISOR_MUTEX_KEY),
      redis.scard("agent:queues"),
      redis.scard("agent:ready"),
      redis.scard("agent:render-ready"),
    ]);
  const report: Record<string, unknown> = {
    at: new Date().toISOString(),
    supervisor: {
      active: summary(active, [
        "version",
        "generation",
        "sandboxName",
        "image",
        "healthUrl",
        "activatedAt",
        "expiresAt",
      ]),
      mutexPresent: mutexExists === 1,
      mutexTtlMs,
    },
    indexes: { conversations: queueCount, ready: readyCount, renderReady: renderReadyCount },
  };

  if (continuation !== undefined) {
    const [depth, activeTurn, parked, ingress, reset, resetPending, ready] = await Promise.all([
      redis.llen(`pending:${continuation}`),
      redis.get(`agent:active:${continuation}`),
      redis.get(`agent:parked:${continuation}`),
      redis.exists(`agent:ingress:${continuation}`),
      redis.exists(`agent:reset:${continuation}`),
      redis.llen(`agent:reset-pending:${continuation}`),
      redis.sismember("agent:ready", `k:${continuation}`),
    ]);
    report["conversation"] = {
      key: continuation,
      pendingDepth: depth,
      resetPendingDepth: resetPending,
      ingressPresent: ingress === 1,
      resetPresent: reset === 1,
      readyMember: ready === 1,
      active: summary(activeTurn, [
        "phase",
        "messageId",
        "dispatchId",
        "sessionId",
        "eveTurnId",
        "deliveryLeaseUntilMs",
      ]),
      parked: summary(parked, ["messageId", "dispatchId", "sessionId", "eveTurnId"]),
    };
  }

  if (dispatch !== undefined) {
    const [ready, target, intent, projection, claim, claimTtlMs, outcome] = await Promise.all([
      redis.sismember("agent:render-ready", `r:${dispatch}`),
      redis.exists(`agent:render-target:${dispatch}`),
      redis.exists(`agent:render-intent:${dispatch}`),
      redis.exists(`agent:render-projection:${dispatch}`),
      redis.exists(`agent:render-claim:${dispatch}`),
      redis.pttl(`agent:render-claim:${dispatch}`),
      redis.get(`agent:render-outcome:${dispatch}`),
    ]);
    report["render"] = {
      dispatchId: dispatch,
      readyMember: ready === 1,
      targetPresent: target === 1,
      intentPresent: intent === 1,
      projectionPresent: projection === 1,
      claimPresent: claim === 1,
      claimTtlMs,
      outcome: outcome === "applied" || outcome === "discarded" ? outcome : undefined,
    };
  }

  console.info(JSON.stringify(report, undefined, 2));
}

async function inspectSchedules(): Promise<void> {
  const url = process.env["TURSO_DATABASE_URL"];
  if (!url) throw new Error("TURSO_DATABASE_URL is required");
  const authToken = process.env["TURSO_AUTH_TOKEN"];
  const client = createClient(authToken ? { url, authToken } : { url });
  try {
    const result = await client.execute(`
      SELECT
        id,
        channel_id,
        description,
        action_type,
        schedule_type,
        status,
        next_run_at,
        available_at,
        lease_expires_at,
        attempt_count,
        last_error,
        last_dispatched_at,
        fire_count,
        updated_at
      FROM scheduled_tasks
      WHERE status IN ('active', 'failed')
      ORDER BY
        CASE status WHEN 'failed' THEN 0 ELSE 1 END,
        available_at ASC,
        id ASC
      LIMIT 100
    `);
    console.info(
      JSON.stringify(
        { at: new Date().toISOString(), count: result.rows.length, tasks: result.rows },
        undefined,
        2,
      ),
    );
  } finally {
    client.close();
  }
}

const [command, ...arguments_] = process.argv.slice(2);
if (command === "redis") await inspectRedis(arguments_);
else if (command === "schedules" && arguments_.length === 0) await inspectSchedules();
else usage();
