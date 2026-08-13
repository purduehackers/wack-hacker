#!/usr/bin/env bun

/**
 * Does the new delivery writer actually move a record through Redis?
 *
 * The old path still serves traffic, so this drives the replacement in
 * isolation on a synthetic key. It exists because "it compiles" has been a
 * misleading signal in this layer more than once: the scripts here are strings,
 * and a Lua typo, a wrong KEYS index, or a fence that reads a field the record
 * does not carry all typecheck perfectly.
 */

import { DeliveryReader } from "../src/conversations/readers/delivery.ts";
import { DeliveryWriter } from "../src/conversations/writers/delivery.ts";
import { redisEnv } from "../src/env/scripts.ts";
import { getRedis } from "../src/redis/client.ts";
import { Result } from "../src/result/index.ts";
import type { DeliveryPayload, MessagePayload } from "../src/wire.ts";

const redis = getRedis(redisEnv());
const writer = new DeliveryWriter(redis);
const reader = new DeliveryReader(redis);

const KEY = "99999999999999701";
const MESSAGE_ID = "99999999999999700";
const DISPATCH = "00000000-0000-4000-8000-00000000d001";
const SESSION = "wrun_writer_probe";

const message: MessagePayload = {
  kind: "mention",
  continuationKey: KEY,
  content: "writer probe",
  messageId: MESSAGE_ID,
  principal: { userId: "99999999999999699", username: "probe", nickname: "probe", memberRoles: [] },
  channel: { id: KEY, name: "writer-probe" },
};
const delivery: DeliveryPayload = { ...message, dispatchId: DISPATCH };

async function scrub(): Promise<void> {
  await redis.del(
    `agent:active:${KEY}`,
    `pending:${KEY}`,
    `agent:seen:${KEY}`,
    `agent:reset:${KEY}`,
    `agent:render-target:${DISPATCH}`,
  );
  await redis.srem("agent:queues", `k:${KEY}`);
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.info(`   ${ok ? "ok  " : "FAIL"} ${label.padEnd(46)} ${JSON.stringify(actual)}`);
  if (!ok) console.error(`        expected ${JSON.stringify(expected)}`);
}

await scrub();

await writer.enqueue(message, delivery, JSON.stringify({ dispatchId: DISPATCH }));
check("enqueue advertises the conversation", await redis.sismember("agent:queues", `k:${KEY}`), 1);
check("enqueue queues one delivery", await reader.queueDepth(KEY), 1);

await writer.enqueue(message, delivery, JSON.stringify({ dispatchId: DISPATCH }));
check("a repeat message is deduped", await reader.queueDepth(KEY), 1);

const claimed = await writer.claim(KEY);
check("claim returns the delivery", Result.isOk(claimed) && claimed.value !== undefined, true);
const claimToken = Result.isOk(claimed) && claimed.value ? claimed.value.claimToken : "";

const afterClaim = await reader.read(KEY);
check("claim writes phase", afterClaim?.phase, "claimed");
check("claim grants a handoff lease", afterClaim?.handoff.holder === claimToken, true);
check("claim grants a turn lease held by the dispatch", afterClaim?.turn.holder, DISPATCH);
check("the record key is bounded", (await redis.pttl(`agent:active:${KEY}`)) > 0, true);

const admitted = await writer.markLive(KEY, DISPATCH, MESSAGE_ID);
check("mark-live admits the first caller", admitted.status, "start");
const afterLive = await reader.read(KEY);
check("mark-live moves the phase", afterLive?.phase, "live");
check("mark-live takes the ingress slot", afterLive?.ingress !== undefined, true);

const second = await writer.markLive(KEY, DISPATCH, MESSAGE_ID);
check("a concurrent caller is refused", second.status, "in-progress");

check("confirm records the session", await writer.confirmSession(KEY, claimToken, SESSION), true);
const replay = await writer.markLive(KEY, DISPATCH, MESSAGE_ID);
check("a retry replays the session", replay.status, "accepted");

check("holder reports the live turn", (await reader.holder(KEY))?.sessionId, SESSION);
check("holder carries the request", (await reader.holder(KEY))?.content, "writer probe");

check("the turn lease refreshes", await writer.refreshTurn(KEY, DISPATCH), true);
check(
  "a stale follower cannot refresh it",
  await writer.refreshTurn(KEY, "00000000-0000-4000-8000-0000000000ff"),
  false,
);

if (admitted.status === "start") {
  check("ingress is released", await writer.releaseIngress(KEY, admitted.attempt), true);
  check("releasing twice is refused", await writer.releaseIngress(KEY, admitted.attempt), false);
}

// The two bad endings. Both publish a terminal render and release the
// conversation, and both take their keys positionally — which is where a
// mistake hides silently, so they are driven rather than reasoned about.
await scrub();
await writer.enqueue(message, delivery, JSON.stringify({ dispatchId: DISPATCH }));
const forExpiry = await writer.claim(KEY);
if (Result.isOk(forExpiry) && forExpiry.value !== undefined) {
  await writer.markLive(KEY, DISPATCH, MESSAGE_ID);
  check("a live turn is not expired", Result.isOk(await writer.expire(KEY)), true);
  check("its record survives", (await reader.read(KEY)) !== undefined, true);

  // Backdate the hold so the sweep sees a turn that has gone quiet.
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
  const intent: unknown = await redis.get(`agent:render-intent:${DISPATCH}`);
  check("it announces a terminal render", intent !== null && intent !== undefined, true);
  check(
    "that announcement is bounded",
    (await redis.pttl(`agent:render-intent:${DISPATCH}`)) > 0,
    true,
  );
  await redis.del(`agent:render-intent:${DISPATCH}`);
  await redis.srem("agent:render-ready", `r:${DISPATCH}`);
}

// Reset. The shadow queue is the part worth proving: a message that arrives
// during a reset must survive it, or the cutover loses the person's words along
// with the conversation's history.
await scrub();
await redis.del(`agent:reset-pending:${KEY}`);
const barrier = await writer.beginReset(KEY);
check("beginReset installs a barrier", barrier.length > 0, true);
check("a retry reuses the same barrier", await writer.beginReset(KEY), barrier);
check("the barrier is bounded", (await redis.pttl(`agent:reset:${KEY}`)) > 0, true);

await writer.enqueue(
  { ...message, messageId: "99999999999999698" },
  { ...delivery, messageId: "99999999999999698" },
  JSON.stringify({ dispatchId: DISPATCH }),
);
check("a message during reset is diverted", await reader.queueDepth(KEY), 0);
check("and is not advertised", await redis.sismember("agent:queues", `k:${KEY}`), 0);

check("commitReset refuses a wrong id", await writer.commitReset(KEY, "not-the-barrier"), false);
check("commitReset completes", await writer.commitReset(KEY, barrier), true);
check("the diverted message is restored", await reader.queueDepth(KEY), 1);
check("and re-advertised", await redis.sismember("agent:queues", `k:${KEY}`), 1);
await redis.del(`agent:reset-pending:${KEY}`);

await scrub();
if (failures === 0) {
  console.info("\nthe delivery writer moves a record through every transition it owns");
} else {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
