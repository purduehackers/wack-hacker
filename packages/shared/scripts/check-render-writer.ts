#!/usr/bin/env bun

/**
 * Does the render writer actually move a paint through Redis?
 *
 * The delivery writer has its own checker for the same reason this one exists:
 * the scripts are strings, and a Lua typo, a wrong KEYS index, or a fence reading
 * a field the record does not carry all typecheck perfectly.
 *
 * Two properties here are worth more than the rest, because both have been broken
 * in production and neither is visible to any other gate. A paint that lands
 * behind the current intent must report `newer` rather than settling — settling
 * early records an outcome, and the outcome is what releases the conversation, so
 * getting it wrong strands everything queued behind a half-painted turn. And a
 * lease lost mid-paint must refuse the completion outright, because a second
 * painter is by then already writing the same messages.
 *
 * Synthetic conversation key, scrubbed either side, so it is safe anywhere.
 */

import { RenderReader } from "../src/conversations/readers/render.ts";
import { DeliveryWriter } from "../src/conversations/writers/delivery.ts";
import { RenderWriter } from "../src/conversations/writers/render.ts";
import { redisEnv } from "../src/env/scripts.ts";
import { getRedis } from "../src/redis/client.ts";
import { Result } from "../src/result/index.ts";
import type { MessagePayload, ParkedPayload, RenderIntent } from "../src/wire.ts";

const redis = getRedis(redisEnv());
const deliveries = new DeliveryWriter(redis);
const writer = new RenderWriter(redis);
const reader = new RenderReader(redis);

const KEY = "99999999999999601";
const MESSAGE_ID = "99999999999999600";
const SESSION = "wrun_render_probe";
const TURN = "wturn_render_probe";

const message: MessagePayload = {
  kind: "mention",
  continuationKey: KEY,
  content: "render probe",
  messageId: MESSAGE_ID,
  principal: { userId: "99999999999999599", username: "probe", nickname: "probe", memberRoles: [] },
  channel: { id: KEY, name: "render-probe" },
};

const minted = new Set<string>();

async function scrub(): Promise<void> {
  await redis.del(
    `agent:active:${KEY}`,
    `agent:parked:${KEY}`,
    `pending:${KEY}`,
    `agent:seen:${KEY}`,
    `agent:reset:${KEY}`,
    `agent:reset-pending:${KEY}`,
  );
  for (const dispatchId of minted) {
    await redis.del(
      `agent:render-target:${dispatchId}`,
      `agent:render-intent:${dispatchId}`,
      `agent:render-projection:${dispatchId}`,
      `agent:render-claim:${dispatchId}`,
      `agent:render-outcome:${dispatchId}`,
    );
    await redis.srem("agent:render-ready", `r:${dispatchId}`);
  }
  await redis.srem("agent:queues", `k:${KEY}`);
  await redis.srem("agent:ready", `k:${KEY}`);
}

/**
 * Scoped to this probe's dispatch rather than the whole set.
 *
 * `agent:render-ready` is global, so it carries whatever real traffic is mid-flight
 * — an assertion on its contents would fail on a busy environment and, worse, pass
 * on an empty one for the wrong reason.
 */
async function advertised(dispatchId: string): Promise<boolean> {
  return (await reader.pending()).includes(dispatchId);
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.info(`   ${ok ? "ok  " : "FAIL"} ${label.padEnd(48)} ${JSON.stringify(actual)}`);
  if (!ok) console.error(`        expected ${JSON.stringify(expected)}`);
}

function intentFor(
  dispatchId: string,
  revision: number,
  phase: RenderIntent["phase"],
  text = "probe",
): RenderIntent {
  return {
    dispatchId,
    continuationKey: KEY,
    messageId: MESSAGE_ID,
    sessionId: SESSION,
    eveTurnId: TURN,
    revision,
    phase,
    text,
    activity: "",
  };
}

function parkedFor(dispatchId: string): ParkedPayload {
  return {
    continuationKey: KEY,
    sessionId: SESSION,
    messageId: MESSAGE_ID,
    dispatchId,
    eveTurnId: TURN,
  };
}

/** A live delivery, which is the only state `publish` will accept. */
async function liveDispatch(): Promise<string> {
  await deliveries.enqueue(message);
  const claimed = await deliveries.claim(KEY);
  if (Result.isError(claimed) || claimed.value === undefined) {
    throw new Error("claim returned nothing");
  }
  const { dispatchId } = claimed.value.payload;
  minted.add(dispatchId);
  await deliveries.markLive(KEY, dispatchId, MESSAGE_ID);
  return dispatchId;
}

async function throws(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

await scrub();

// Publishing: the agent's side. The revision fence is the whole contract.
const dispatchId = await liveDispatch();
const published = await writer.publish(intentFor(dispatchId, 1, "streaming"));
check("publish is accepted", published.accepted, true);
check("publish wakes the renderer", published.shouldWake, true);
check("it advertises the dispatch", await advertised(dispatchId), true);
check("the intent is bounded", (await redis.pttl(`agent:render-intent:${dispatchId}`)) > 0, true);

const again = await writer.publish(intentFor(dispatchId, 1, "streaming"));
check("republishing the same frame is accepted", again.accepted, true);
// Still wakes: the previous nudge is a best-effort HTTP call that may have been
// lost, and the frame is by definition still unpainted. Only a publish that finds
// the dispatch already advertised suppresses it.
check("and nudges again, because the last nudge may have been lost", again.shouldWake, true);
check(
  "a reused revision with new content is refused",
  await throws(() => writer.publish(intentFor(dispatchId, 1, "streaming", "different"))),
  true,
);
check(
  "a straggler behind the current frame is dropped",
  (await writer.publish(intentFor(dispatchId, 1, "streaming"))).accepted,
  true,
);
const advanced = await writer.publish(intentFor(dispatchId, 2, "streaming", "second"));
check("a newer frame replaces it", advanced.accepted, true);
const readIntent = await reader.intent(dispatchId);
check("and reads back", Result.isOk(readIntent) && readIntent.value?.revision, 2);
check("publishing pushes the turn lease out", (await redis.pttl(`agent:active:${KEY}`)) > 0, true);

// Painting: the bot's side.
const token = await writer.claim(dispatchId);
check("claim grants the paint lease", token !== undefined, true);
if (token === undefined) process.exit(1);
check("a second painter is refused", (await writer.claim(dispatchId)) === undefined, true);
check("renew holds it", await writer.renew(dispatchId, token), true);
check("a stranger cannot renew it", await writer.renew(dispatchId, "not-the-holder"), false);

check(
  "checkpoint records the projection",
  await writer.checkpoint(dispatchId, token, { overflow: [], anchorMessageId: MESSAGE_ID }, 1),
  true,
);
const checkpointed = await reader.projection(dispatchId);
check(
  "and it reads back",
  Result.isOk(checkpointed) && checkpointed.value.anchorMessageId,
  MESSAGE_ID,
);
check(
  "a stranger cannot checkpoint",
  await writer.checkpoint(dispatchId, "not-the-holder", { overflow: [] }, 1),
  false,
);

// The property that strands conversations when it is wrong.
check(
  "completing behind the current intent reports newer",
  await writer.complete({
    dispatchId,
    claimToken: token,
    projection: { overflow: [], anchorMessageId: MESSAGE_ID },
    appliedRevision: 1,
    terminal: false,
  }),
  "newer",
);
check("so the dispatch stays advertised", await advertised(dispatchId), true);

const second = await writer.claim(dispatchId);
if (second === undefined) process.exit(1);
check(
  "catching up settles it",
  await writer.complete({
    dispatchId,
    claimToken: second,
    projection: { overflow: [], anchorMessageId: MESSAGE_ID },
    appliedRevision: 2,
    terminal: false,
  }),
  "caught-up",
);
check("the dispatch is no longer advertised", await advertised(dispatchId), false);
check("a non-terminal paint records no outcome", await reader.outcome(dispatchId), undefined);
check(
  "a lost lease refuses the completion",
  await writer.complete({
    dispatchId,
    claimToken: second,
    projection: { overflow: [] },
    appliedRevision: 2,
    terminal: false,
  }),
  "lost",
);

// Parking: the terminal frame and the hand-off to a person, atomically.
const settled = await writer.settleAndPark(
  intentFor(dispatchId, 3, "completed", "done"),
  parkedFor(dispatchId),
);
check("settle returns the revision it landed on", settled, 3);
check("it parks the delivery", (await redis.exists(`agent:parked:${KEY}`)) === 1, true);
// A parked marker outliving its record is invariant I5: `complete` can never
// fence against it again, so it is both unusable and uncollectable.
check("with a bounded marker", (await redis.pttl(`agent:parked:${KEY}`)) > 0, true);
check("and re-advertises the paint", await advertised(dispatchId), true);
check(
  "a streaming intent cannot settle",
  await throws(() =>
    writer.settleAndPark(intentFor(dispatchId, 4, "streaming"), parkedFor(dispatchId)),
  ),
  true,
);

const terminal = await writer.claim(dispatchId);
if (terminal === undefined) process.exit(1);
check(
  "the terminal paint settles",
  await writer.complete({
    dispatchId,
    claimToken: terminal,
    projection: { overflow: [], anchorMessageId: MESSAGE_ID },
    appliedRevision: 3,
    terminal: true,
  }),
  "caught-up",
);
check("and records a durable outcome", await reader.outcome(dispatchId), "applied");

// Release and discard, the two ways a paint ends without applying.
await scrub();
const spare = await liveDispatch();
await writer.publish(intentFor(spare, 1, "streaming"));
const held = await writer.claim(spare);
if (held === undefined) process.exit(1);
check("release gives the lease back", await writer.release(spare, held), true);
check("releasing twice is refused", await writer.release(spare, held), false);
check("so another painter can take it", (await writer.claim(spare)) !== undefined, true);

await writer.discard(spare);
check("discard records the outcome", await reader.outcome(spare), "discarded");
check("and withdraws the dispatch", await advertised(spare), false);
check("the intent survives, bounded", (await redis.pttl(`agent:render-intent:${spare}`)) > 0, true);

await scrub();
if (failures === 0) {
  console.info("\nthe render writer moves a paint through every transition it owns");
} else {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
