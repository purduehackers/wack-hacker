#!/usr/bin/env bun

/**
 * @fileoverview Read-only operations probe for a stuck conversation.
 *
 * The `redis` command prints supervisor state, queue depths, and the lease
 * records for one continuation or render dispatch. The `schedules` command
 * lists active and failed scheduled tasks from Turso. The tool only reads,
 * so an operator can run it against production without changing anything.
 */

import { createClient } from "@libsql/client";
import { Redis } from "@upstash/redis";
import { z } from "zod";

import { BOT_ACTIVE_GENERATION_KEY, BOT_SUPERVISOR_MUTEX_KEY } from "../src/bot/generation.ts";
import {
  activeKey,
  AGENT_READY_SET_KEY,
  AGENT_RENDER_READY_SET_KEY,
  parkedKey,
  pendingKey,
  QUEUE_INDEX_KEY,
  queueMember,
  renderClaimKey,
  renderIntentKey,
  renderMember,
  renderOutcomeKey,
  renderProjectionKey,
  renderTargetKey,
  resetKey,
  resetPendingKey,
} from "../src/conversations/keys.ts";
import { redisEnv, tursoEnv } from "../src/env/scripts.ts";
import { jsonCodec } from "../src/json.ts";

/**
 * JSON text to an unvalidated value — deliberately, and only here.
 *
 * This used to live in `json.ts` as an export, where it was a standing invitation
 * to skip validation at an io boundary. This tool is the one place the shape
 * genuinely is unknown. It prints whatever is under an arbitrary Redis key, for a
 * person reading the output. Every other reader of a Redis record knows what it
 * expects and says so with `stored(schema)`.
 */
const jsonText = jsonCodec(z.json());

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

/** The key helpers build Redis keys by interpolation, so an argument's shape is a guard. */
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

/** Any keyed blob. The wanted fields differ per key, so this schema declares none. */
const anyRecordSchema = z.record(z.string(), z.json());

/** Marker row for a blob that the tool cannot project field-by-field. */
interface PresenceMarker {
  readonly present: boolean;
  readonly malformed?: boolean;
}

function malformedMarker(): PresenceMarker {
  return { present: true, malformed: true };
}

function presenceMarker(value: unknown): PresenceMarker {
  return { present: value !== undefined && value !== null };
}

/**
 * Picks fields out of an arbitrary Redis blob for display. This function
 * validates nothing beyond "is it a keyed object", so the result stays
 * `unknown`: it is the any-barrier over `JSON.parse`/`Object.fromEntries`, not
 * an erasure. The only consumer is `JSON.stringify`.
 */
function summary(raw: unknown, fields: readonly string[]): unknown {
  const text = z.string().safeParse(raw);
  if (text.success) {
    const decoded = jsonText.safeParse(text.data);
    if (!decoded.success) return malformedMarker();
    return pick(decoded.data, fields);
  }
  return pick(raw, fields);
}

function pick(value: unknown, fields: readonly string[]): unknown {
  const record = anyRecordSchema.safeParse(value);
  if (!record.success) return presenceMarker(value);
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

  const [active, mutexExists, mutexTtlMs, conversationCount, ready, renderReady] =
    await Promise.all([
      redis.get(BOT_ACTIVE_GENERATION_KEY),
      redis.exists(BOT_SUPERVISOR_MUTEX_KEY),
      redis.pttl(BOT_SUPERVISOR_MUTEX_KEY),
      redis.scard(QUEUE_INDEX_KEY),
      redis.scard(AGENT_READY_SET_KEY),
      redis.scard(AGENT_RENDER_READY_SET_KEY),
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
    indexes: { conversations: conversationCount, ready, renderReady },
  };

  if (continuation !== undefined) {
    const [depth, activeRecord, parked, reset, resetPending, readyMember] = await Promise.all([
      redis.llen(pendingKey(continuation)),
      redis.get(activeKey(continuation)),
      redis.get(parkedKey(continuation)),
      redis.exists(resetKey(continuation)),
      redis.llen(resetPendingKey(continuation)),
      redis.sismember(AGENT_READY_SET_KEY, queueMember(continuation)),
    ]);
    report.conversation = {
      key: continuation,
      pendingDepth: depth,
      resetPendingDepth: resetPending,
      resetPresent: reset === 1,
      readyMember: readyMember === 1,
      // "Why is this stuck" comes down to who holds which lease and until
      // when, so the report prints all three.
      active: summary(activeRecord, [
        "phase",
        "messageId",
        "dispatchId",
        "sessionId",
        "eveTurnId",
        "handoff",
        "turn",
        "ingress",
      ]),
      parked: summary(parked, ["messageId", "dispatchId", "sessionId", "eveTurnId"]),
    };
  }

  if (dispatch !== undefined) {
    const [readyMember, target, intent, projection, claim, claimTtlMs, outcome] = await Promise.all(
      [
        redis.sismember(AGENT_RENDER_READY_SET_KEY, renderMember(dispatch)),
        redis.exists(renderTargetKey(dispatch)),
        redis.exists(renderIntentKey(dispatch)),
        redis.exists(renderProjectionKey(dispatch)),
        redis.exists(renderClaimKey(dispatch)),
        redis.pttl(renderClaimKey(dispatch)),
        redis.get(renderOutcomeKey(dispatch)),
      ],
    );
    report.render = {
      dispatchId: dispatch,
      readyMember: readyMember === 1,
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
