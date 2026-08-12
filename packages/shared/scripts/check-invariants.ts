#!/usr/bin/env bun

/**
 * Does the control plane still hold together?
 *
 * Drives one delivery through the real Lua — enqueue, claim, admission, render,
 * park, complete — checking every invariant after every transition. Then it cuts
 * the sequence short at each step in turn, which is what a crash actually looks
 * like, and asks the only question that matters afterwards: is the state
 * bounded, or has this conversation been taken hostage.
 *
 * Written because five defects in one night all lived in this layer, and every
 * one was invisible to `tsc` and to lint. The properties they broke are not
 * type-level: they are things eleven Lua scripts each have to remember about one
 * shared Redis record, and nothing but this checks them.
 *
 * Uses a synthetic conversation key, scrubbed on the way in and out, so it is
 * safe to point at any environment.
 */

import { z } from "zod";

import { createAdmissionTransitions } from "../src/conversations/admission.ts";
import { createQueueTransitions } from "../src/conversations/queue.ts";
import { createRenderPublicationTransitions } from "../src/conversations/render-publication.ts";
import { redisEnv } from "../src/env/scripts.ts";
import { getRedis } from "../src/redis/client.ts";
import { Result } from "../src/result/index.ts";
import type { DeliveryPayload, MessagePayload, ParkedPayload, RenderIntent } from "../src/wire.ts";

const redis = getRedis(redisEnv());
const queue = createQueueTransitions(redis);
const admission = createAdmissionTransitions(redis);
const publication = createRenderPublicationTransitions(redis);

/** Outside the range Discord mints, so it can never collide with real traffic. */
const KEY = "99999999999999901";
const MESSAGE_ID = "99999999999999900";
const SESSION_ID = "wrun_invariant_probe";

/** Only the fields the invariants below are stated in terms of. */
const activeRecordSchema = z.looseObject({
  phase: z.string(),
  expiresAtMs: z.number().optional(),
});

const message: MessagePayload = {
  kind: "mention",
  continuationKey: KEY,
  content: "invariant probe",
  messageId: MESSAGE_ID,
  principal: { userId: "99999999999999899", username: "probe", nickname: "probe", memberRoles: [] },
  channel: { id: KEY, name: "invariant-probe" },
};

function intentFor(
  dispatchId: string,
  revision: number,
  phase: RenderIntent["phase"],
): RenderIntent {
  return {
    dispatchId,
    continuationKey: KEY,
    messageId: MESSAGE_ID,
    sessionId: SESSION_ID,
    eveTurnId: "turn_1",
    revision,
    phase,
    text: "probe",
    activity: phase === "streaming" ? "working…" : "",
  };
}

function parkedFor(dispatchId: string): ParkedPayload {
  return {
    continuationKey: KEY,
    sessionId: SESSION_ID,
    messageId: MESSAGE_ID,
    dispatchId,
    eveTurnId: "turn_1",
  };
}

/** The delivery the claim handed back; every later step is fenced on its id. */
let claimed: DeliveryPayload | undefined;

async function readActive(): Promise<z.output<typeof activeRecordSchema> | undefined> {
  const raw: unknown = await redis.get(`agent:active:${KEY}`);
  if (raw === null || raw === undefined) return undefined;
  const text = z.string().safeParse(raw);
  const decoded: unknown = text.success ? JSON.parse(text.data) : raw;
  const parsed = activeRecordSchema.safeParse(decoded);
  return parsed.success ? parsed.data : undefined;
}

async function scrub(): Promise<void> {
  const dispatchId = claimed?.dispatchId;
  await redis.del(
    `agent:active:${KEY}`,
    `pending:${KEY}`,
    `agent:parked:${KEY}`,
    `agent:ingress:${KEY}`,
    `agent:seen:${KEY}`,
  );
  if (dispatchId !== undefined) {
    await redis.del(
      `agent:render-intent:${dispatchId}`,
      `agent:render-target:${dispatchId}`,
      `agent:render-outcome:${dispatchId}`,
      `agent:render-projection:${dispatchId}`,
    );
    await redis.srem("agent:render-ready", `r:${dispatchId}`);
  }
  await redis.srem("agent:queues", `k:${KEY}`);
  await redis.srem("agent:ready", `k:${KEY}`);
  claimed = undefined;
}

/**
 * Five properties no single script owns, which is exactly why they break.
 *
 * Each one is a way a conversation stops making progress rather than a way a
 * request fails, so nothing upstream ever reports them.
 */
async function check(label: string): Promise<readonly string[]> {
  const [active, pending, ttl, parkedMarker, indexed] = await Promise.all([
    readActive(),
    redis.llen(`pending:${KEY}`),
    redis.pttl(`agent:active:${KEY}`),
    redis.get(`agent:parked:${KEY}`),
    redis.sismember("agent:queues", `k:${KEY}`),
  ]);
  const inIndex = indexed === 1;
  const violations: string[] = [];
  if (pending > 0 && !inIndex)
    violations.push("I1 queued work is not in the index, so it never drains");
  if (active !== undefined && ttl === -1) violations.push("I2 the active record has no expiry");
  if (active !== undefined && active.expiresAtMs === undefined) {
    violations.push("I3 the active record carries no lease for the sweep to read");
  }
  if (active === undefined && pending === 0 && inIndex) violations.push("I4 index entry leaked");
  if (parkedMarker !== null && parkedMarker !== undefined && active === undefined) {
    violations.push("I5 parked marker with no record, so complete can never fence");
  }
  const mark = violations.length === 0 ? "ok  " : "FAIL";
  const phase = active?.phase ?? "-";
  console.info(
    `   ${mark} ${label.padEnd(32)} ttlMs=${String(ttl).padStart(9)} phase=${phase.padEnd(18)} pending=${pending} indexed=${inIndex}`,
  );
  for (const entry of violations) console.error(`        ${entry}`);
  return violations;
}

const steps: ReadonlyArray<readonly [string, () => Promise<void>]> = [
  ["enqueue", async () => queue.enqueue(message)],
  [
    "claim",
    async () => {
      const outcome = await queue.claim(KEY);
      if (Result.isError(outcome)) throw new Error(`claim failed: ${outcome.error.message}`);
      if (outcome.value === undefined) throw new Error("claim returned nothing");
      claimed = outcome.value.payload;
    },
  ],
  [
    "admission.start",
    async () => {
      if (claimed === undefined) throw new Error("no claimed delivery");
      const started = await admission.start(claimed);
      if (started.status !== "start") throw new Error(`start returned ${started.status}`);
    },
  ],
  [
    "admission.confirm",
    async () => {
      if (claimed === undefined) throw new Error("no claimed delivery");
      if (!(await admission.confirm(claimed, SESSION_ID))) throw new Error("confirm was rejected");
    },
  ],
  [
    "publish(streaming)",
    async () => {
      if (claimed === undefined) throw new Error("no claimed delivery");
      const published = await publication.publish(intentFor(claimed.dispatchId, 1, "streaming"));
      if (!published.accepted) throw new Error("publish was rejected");
    },
  ],
  [
    "settleAndPark",
    async () => {
      if (claimed === undefined) throw new Error("no claimed delivery");
      const settled = await publication.settleAndPark(
        intentFor(claimed.dispatchId, 2, "completed"),
        parkedFor(claimed.dispatchId),
      );
      if (settled === undefined) throw new Error("settle was rejected");
    },
  ],
  [
    // Stands in for the bot: `complete` refuses until the paint is recorded.
    "bot records the paint",
    async () => {
      if (claimed === undefined) throw new Error("no claimed delivery");
      await redis.set(`agent:render-outcome:${claimed.dispatchId}`, "applied");
    },
  ],
  [
    "complete",
    async () => {
      if (claimed === undefined) throw new Error("no claimed delivery");
      const status = await queue.complete(parkedFor(claimed.dispatchId));
      if (status !== "completed") throw new Error(`complete returned ${status}`);
    },
  ],
];

let failures = 0;

console.info("happy path — invariants after every transition\n");
await scrub();
for (const [name, run] of steps) {
  try {
    await run();
  } catch (cause) {
    console.error(
      `   FAIL ${name} threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    failures += 1;
  }
  failures += (await check(name)).length;
}

console.info("\ncrash injection — stop after step N, then ask whether the state is bounded\n");
for (let cut = 1; cut < steps.length; cut += 1) {
  await scrub();
  for (let index = 0; index < cut; index += 1) {
    try {
      await steps[index]?.[1]();
    } catch {
      // The crash under test; the invariants below are the assertion.
    }
  }
  failures += (await check(`crash after ${steps[cut - 1]?.[0] ?? "?"}`)).length;
  const active = await readActive();
  const remainingMs = await redis.pttl(`agent:active:${KEY}`);
  if (active !== undefined && active.expiresAtMs === undefined && remainingMs === -1) {
    console.error("        unbounded: nothing will ever release this conversation");
    failures += 1;
  }
}

await scrub();
if (failures === 0) {
  console.info("\nall invariants hold across every path");
} else {
  console.error(`\n${failures} invariant violation(s)`);
  process.exit(1);
}
