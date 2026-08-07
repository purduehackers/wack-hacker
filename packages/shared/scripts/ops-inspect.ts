#!/usr/bin/env bun

import { createClient } from "@libsql/client";
import { Redis } from "@upstash/redis";

import { BOT_ACTIVE_GENERATION_KEY, BOT_SUPERVISOR_MUTEX_KEY } from "../src/bot-generation.ts";
import { createConversationStore } from "../src/conversations/index.ts";

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
  const conversations = createConversationStore({ redis });

  const [active, mutexExists, mutexTtlMs, indexes] = await Promise.all([
    redis.get(BOT_ACTIVE_GENERATION_KEY),
    redis.exists(BOT_SUPERVISOR_MUTEX_KEY),
    redis.pttl(BOT_SUPERVISOR_MUTEX_KEY),
    conversations.inspectIndexes(),
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
    indexes,
  };

  if (continuation !== undefined) {
    const state = await conversations.inspectConversation(continuation);
    report["conversation"] = {
      key: continuation,
      pendingDepth: state.depth,
      resetPendingDepth: state.resetPending,
      ingressPresent: state.ingress === 1,
      resetPresent: state.reset === 1,
      readyMember: state.ready === 1,
      active: summary(state.active, [
        "phase",
        "messageId",
        "dispatchId",
        "sessionId",
        "eveTurnId",
        "deliveryLeaseUntilMs",
      ]),
      parked: summary(state.parked, ["messageId", "dispatchId", "sessionId", "eveTurnId"]),
    };
  }

  if (dispatch !== undefined) {
    const state = await conversations.inspectRender(dispatch);
    report["render"] = {
      dispatchId: dispatch,
      readyMember: state.ready === 1,
      targetPresent: state.target === 1,
      intentPresent: state.intent === 1,
      projectionPresent: state.projection === 1,
      claimPresent: state.claim === 1,
      claimTtlMs: state.claimTtlMs,
      outcome:
        state.outcome === "applied" || state.outcome === "discarded" ? state.outcome : undefined,
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
