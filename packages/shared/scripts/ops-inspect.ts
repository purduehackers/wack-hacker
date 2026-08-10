#!/usr/bin/env bun

import { createClient } from "@libsql/client";
import { Redis } from "@upstash/redis";
import { z } from "zod";

import { BOT_ACTIVE_GENERATION_KEY, BOT_SUPERVISOR_MUTEX_KEY } from "../src/bot/generation.ts";
import { createConversationStore } from "../src/conversations/index.ts";
import { redisEnv, tursoEnv } from "../src/env/scripts.ts";
import { jsonText } from "../src/json.ts";

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

/** Redis keys are built by interpolation, so an argument's shape is a guard. */
const continuationKeySchema = z
  .string()
  .max(256)
  .regex(/^[^\r\n]*$/u);
const dispatchIdSchema = z.stringFormat("dispatch-id", /^[A-Za-z0-9_-]{1,128}$/u);

function check<S extends z.ZodType<string, string>>(
  schema: S,
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data;
}

/** Any keyed blob; the fields wanted differ per key, so none are declared. */
const anyRecordSchema = z.looseObject({});

/**
 * Picks fields out of an arbitrary Redis blob for display. Nothing here is
 * validated beyond "is it a keyed object", so the result stays `unknown`: it is
 * the any-barrier over `JSON.parse`/`Object.fromEntries`, not an erasure. The
 * only consumer is `JSON.stringify`.
 */
function summary(raw: unknown, fields: readonly string[]): unknown {
  const text = z.string().safeParse(raw);
  if (text.success) {
    const decoded = jsonText.safeParse(text.data);
    if (!decoded.success) return { present: true, malformed: true };
    return pick(decoded.data, fields);
  }
  return pick(raw, fields);
}

function pick(value: unknown, fields: readonly string[]): unknown {
  const record = anyRecordSchema.safeParse(value);
  if (!record.success) return { present: value !== undefined && value !== null };
  return Object.fromEntries(
    fields.flatMap((fieldName) => {
      const candidate = record.data[fieldName];
      return candidate === undefined ? [] : [[fieldName, candidate]];
    }),
  );
}

interface ConversationReport {
  readonly key: string;
  readonly pendingDepth: number;
  readonly resetPendingDepth: number;
  readonly ingressPresent: boolean;
  readonly resetPresent: boolean;
  readonly readyMember: boolean;
  readonly active: unknown;
  readonly parked: unknown;
}

interface RenderReport {
  readonly dispatchId: string;
  readonly readyMember: boolean;
  readonly targetPresent: boolean;
  readonly intentPresent: boolean;
  readonly projectionPresent: boolean;
  readonly claimPresent: boolean;
  readonly claimTtlMs: number;
  readonly outcome: "applied" | "discarded" | undefined;
}

interface OpsReport {
  readonly at: string;
  readonly supervisor: {
    readonly active: unknown;
    readonly mutexPresent: boolean;
    readonly mutexTtlMs: number;
  };
  readonly indexes: {
    readonly conversations: number;
    readonly ready: number;
    readonly renderReady: number;
  };
  conversation?: ConversationReport;
  render?: RenderReport;
}

async function inspectRedis(arguments_: readonly string[]): Promise<void> {
  const allowed = new Set(["--continuation", "--dispatch"]);
  for (let index = 0; index < arguments_.length; index += 2) {
    if (!allowed.has(arguments_[index] ?? "") || arguments_[index + 1] === undefined) usage();
  }
  const continuation = check(continuationKeySchema, option(arguments_, "--continuation"));
  const dispatch = check(dispatchIdSchema, option(arguments_, "--dispatch"));

  const redis = new Redis(redisEnv());
  const conversations = createConversationStore({ redis });

  const [active, mutexExists, mutexTtlMs, indexes] = await Promise.all([
    redis.get(BOT_ACTIVE_GENERATION_KEY),
    redis.exists(BOT_SUPERVISOR_MUTEX_KEY),
    redis.pttl(BOT_SUPERVISOR_MUTEX_KEY),
    conversations.inspectIndexes(),
  ]);
  const report: OpsReport = {
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
    report.conversation = {
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
    report.render = {
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
  const { url, authToken } = tursoEnv();
  const client = createClient(authToken === undefined ? { url } : { url, authToken });
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
