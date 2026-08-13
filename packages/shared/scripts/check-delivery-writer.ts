#!/usr/bin/env bun

/**
 * Does the delivery writer actually move a record through Redis?
 *
 * It exists because "it compiles" has been a misleading signal in this layer
 * more than once: the scripts are strings, and a Lua typo, a wrong KEYS index,
 * or a fence reading a field the record does not carry all typecheck perfectly.
 *
 * The dispatch id is read back from the claim rather than fixed here. `enqueue`
 * mints it, and a check that asserts against an id the code never used passes
 * while testing nothing — which is exactly how an earlier checker in this repo
 * managed to report success against scripts that were all answering "stale".
 *
 * Synthetic conversation key, scrubbed either side, so it is safe anywhere.
 */

import { DeliveryReader } from "../src/conversations/readers/delivery.ts";
import { DeliveryWriter } from "../src/conversations/writers/delivery.ts";
import { redisEnv } from "../src/env/scripts.ts";
import { getRedis } from "../src/redis/client.ts";
import { Result } from "../src/result/index.ts";
import type { MessagePayload } from "../src/wire.ts";

const redis = getRedis(redisEnv());
const writer = new DeliveryWriter(redis);
const reader = new DeliveryReader(redis);

const KEY = "99999999999999701";
const MESSAGE_ID = "99999999999999700";
const SESSION = "wrun_writer_probe";

const message: MessagePayload = {
  kind: "mention",
  continuationKey: KEY,
  content: "writer probe",
  messageId: MESSAGE_ID,
  principal: { userId: "99999999999999699", username: "probe", nickname: "probe", memberRoles: [] },
  channel: { id: KEY, name: "writer-probe" },
};

/** Render keys are per-dispatch, so scrubbing needs whichever ids were minted. */
const minted = new Set<string>();

async function scrub(): Promise<void> {
  await redis.del(
    `agent:active:${KEY}`,
    `pending:${KEY}`,
    `agent:seen:${KEY}`,
    `agent:reset:${KEY}`,
    `agent:reset-pending:${KEY}`,
  );
  for (const dispatchId of minted) {
    await redis.del(`agent:render-target:${dispatchId}`, `agent:render-intent:${dispatchId}`);
    await redis.srem("agent:render-ready", `r:${dispatchId}`);
  }
  await redis.srem("agent:queues", `k:${KEY}`);
  await redis.srem("agent:ready", `k:${KEY}`);
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.info(`   ${ok ? "ok  " : "FAIL"} ${label.padEnd(46)} ${JSON.stringify(actual)}`);
  if (!ok) console.error(`        expected ${JSON.stringify(expected)}`);
}

/** Queue one message and take it, returning the dispatch the writer minted. */
async function queueAndClaim(payload: MessagePayload): Promise<{
  readonly dispatchId: string;
  readonly claimToken: string;
}> {
  await writer.enqueue(payload);
  const claimed = await writer.claim(KEY);
  if (Result.isError(claimed) || claimed.value === undefined) {
    throw new Error("claim returned nothing");
  }
  minted.add(claimed.value.payload.dispatchId);
  return { dispatchId: claimed.value.payload.dispatchId, claimToken: claimed.value.claimToken };
}

await scrub();

await writer.enqueue(message);
check("enqueue advertises the conversation", await redis.sismember("agent:queues", `k:${KEY}`), 1);
check("enqueue queues one delivery", await reader.queueDepth(KEY), 1);
await writer.enqueue(message);
check("a repeat message is deduped", await reader.queueDepth(KEY), 1);

const first = await writer.claim(KEY);
check("claim returns the delivery", Result.isOk(first) && first.value !== undefined, true);
if (Result.isError(first) || first.value === undefined) process.exit(1);
const dispatchId = first.value.payload.dispatchId;
const claimToken = first.value.claimToken;
minted.add(dispatchId);

const afterClaim = await reader.read(KEY);
check("claim writes phase", afterClaim?.phase, "claimed");
check("claim grants a handoff lease", afterClaim?.handoff.holder === claimToken, true);
check("claim grants a turn lease held by the dispatch", afterClaim?.turn.holder, dispatchId);
check("the record key is bounded", (await redis.pttl(`agent:active:${KEY}`)) > 0, true);

const admitted = await writer.markLive(KEY, dispatchId, MESSAGE_ID);
check("mark-live admits the first caller", admitted.status, "start");
check("mark-live moves the phase", (await reader.read(KEY))?.phase, "live");
check("mark-live takes the ingress slot", (await reader.read(KEY))?.ingress !== undefined, true);
check(
  "a concurrent caller is refused",
  (await writer.markLive(KEY, dispatchId, MESSAGE_ID)).status,
  "in-progress",
);

check("confirm records the session", await writer.confirmSession(KEY, claimToken, SESSION), true);
check(
  "a retry replays the session",
  (await writer.markLive(KEY, dispatchId, MESSAGE_ID)).status,
  "accepted",
);

check("holder reports the live turn", (await reader.holder(KEY))?.sessionId, SESSION);
check("holder carries the request", (await reader.holder(KEY))?.content, "writer probe");
check("the turn lease refreshes", await writer.refreshTurn(KEY, dispatchId), true);
check(
  "a stale follower cannot refresh it",
  await writer.refreshTurn(KEY, "00000000-0000-4000-8000-0000000000ff"),
  false,
);
if (admitted.status === "start") {
  check("ingress is released", await writer.releaseIngress(KEY, admitted.attempt), true);
  check("releasing twice is refused", await writer.releaseIngress(KEY, admitted.attempt), false);
}

// The bad ending. It splices a different key list into the same announcement
// helper as recovery, so an off-by-one here is invisible to the compiler.
await scrub();
const expiring = await queueAndClaim(message);
await writer.markLive(KEY, expiring.dispatchId, MESSAGE_ID);
check("a live turn is not expired", Result.isOk(await writer.expire(KEY)), true);
check("its record survives", (await reader.read(KEY)) !== undefined, true);

const held = await reader.read(KEY);
if (held !== undefined) {
  await redis.set(
    `agent:active:${KEY}`,
    JSON.stringify({ ...held, turn: { ...held.turn, expiresAtMs: Date.now() - 1_000 } }),
    { keepTtl: true },
  );
}
const expired = await writer.expire(KEY);
check("a lapsed turn is given up on", Result.isOk(expired) && expired.value !== undefined, true);
check("its record is released", await reader.read(KEY), undefined);
const intent: unknown = await redis.get(`agent:render-intent:${expiring.dispatchId}`);
check("it announces a terminal render", intent !== null && intent !== undefined, true);
check(
  "that announcement is bounded",
  (await redis.pttl(`agent:render-intent:${expiring.dispatchId}`)) > 0,
  true,
);

// Reset. The shadow queue is the part worth proving: a message that arrives
// during a reset must survive it, or the cutover loses the person's words along
// with the conversation's history.
await scrub();
const barrier = await writer.beginReset(KEY);
check("beginReset installs a barrier", barrier.length > 0, true);
check("a retry reuses the same barrier", await writer.beginReset(KEY), barrier);
check("the barrier is bounded", (await redis.pttl(`agent:reset:${KEY}`)) > 0, true);

await writer.enqueue({ ...message, messageId: "99999999999999698" });
check("a message during reset is diverted", await reader.queueDepth(KEY), 0);
check("and is not advertised", await redis.sismember("agent:queues", `k:${KEY}`), 0);
check("commitReset refuses a wrong id", await writer.commitReset(KEY, "not-the-barrier"), false);
check("commitReset completes", await writer.commitReset(KEY, barrier), true);
check("the diverted message is restored", await reader.queueDepth(KEY), 1);
check("and re-advertised", await redis.sismember("agent:queues", `k:${KEY}`), 1);

await scrub();
if (failures === 0) {
  console.info("\nthe delivery writer moves a record through every transition it owns");
} else {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
