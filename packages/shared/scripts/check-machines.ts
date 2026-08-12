#!/usr/bin/env bun

/**
 * Do the transition tables and the Lua still agree?
 *
 * The machines in `conversations/machines/` are a specification; Redis is the
 * authority. That split is only safe while the two say the same thing, and
 * nothing about the arrangement makes it true — a guard edited in one place and
 * not the other is exactly the drift this catches.
 *
 * So: for every phase and every event, ask the machine whether the move is
 * legal, then attempt it against real Redis and see whether it happened. A
 * disagreement in either direction is a failure, and the direction matters —
 * "Lua allowed what the spec forbids" is a missing guard, "the spec allows what
 * Lua refuses" is a fence nobody documented.
 *
 * Uses a synthetic conversation key outside the range Discord mints, scrubbed on
 * the way in and out, so it is safe to point at any environment.
 */

import { z } from "zod";

import { createAdmissionTransitions } from "../src/conversations/admission.ts";
import type { DeliveryContext, DeliveryEvent } from "../src/conversations/machines/index.ts";
import { allowsDelivery, DeliveryPhase } from "../src/conversations/machines/index.ts";
import type { DeliveryPhase as DeliveryPhaseValue } from "../src/conversations/machines/index.ts";
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

const KEY = "99999999999999801";
const MESSAGE_ID = "99999999999999800";
const SESSION_ID = "wrun_machine_probe";

const activeSchema = z.looseObject({ phase: z.string(), sessionId: z.string().optional() });

const message: MessagePayload = {
  kind: "mention",
  continuationKey: KEY,
  content: "machine probe",
  messageId: MESSAGE_ID,
  principal: { userId: "99999999999999799", username: "probe", nickname: "probe", memberRoles: [] },
  channel: { id: KEY, name: "machine-probe" },
};

async function readPhase(): Promise<string | undefined> {
  const raw: unknown = await redis.get(`agent:active:${KEY}`);
  if (raw === null || raw === undefined) return undefined;
  const text = z.string().safeParse(raw);
  const decoded: unknown = text.success ? JSON.parse(text.data) : raw;
  const parsed = activeSchema.safeParse(decoded);
  return parsed.success ? parsed.data.phase : undefined;
}

async function scrub(dispatchId?: string): Promise<void> {
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
}

/** Drive Redis into a given phase, returning the delivery that got it there. */
async function arrange(target: DeliveryPhaseValue): Promise<DeliveryPayload | undefined> {
  await scrub();
  await queue.enqueue(message);
  const claimed = await queue.claim(KEY);
  if (Result.isError(claimed) || claimed.value === undefined) return undefined;
  const delivery = claimed.value.payload;
  if (target === DeliveryPhase.Claimed) return delivery;

  const started = await admission.start(delivery);
  if (started.status !== "start") return undefined;
  await admission.confirm(delivery, SESSION_ID);
  if (target === DeliveryPhase.Live) return delivery;

  if (target === DeliveryPhase.Parked) {
    const intent: RenderIntent = {
      dispatchId: delivery.dispatchId,
      continuationKey: KEY,
      messageId: MESSAGE_ID,
      sessionId: SESSION_ID,
      eveTurnId: "turn_1",
      revision: 1,
      phase: "completed",
      text: "probe",
      activity: "",
    };
    const parked: ParkedPayload = {
      continuationKey: KEY,
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      dispatchId: delivery.dispatchId,
      eveTurnId: "turn_1",
    };
    await publication.settleAndPark(intent, parked);
    return delivery;
  }
  return undefined;
}

/** Attempt the event against Redis; report whether the phase actually moved. */
async function attempt(
  event: DeliveryEvent,
  delivery: DeliveryPayload,
  before: string,
): Promise<boolean> {
  switch (event.type) {
    case "MARK_LIVE": {
      const started = await admission.start(delivery);
      return started.status === "start";
    }
    case "PARK": {
      const settled = await publication.settleAndPark(
        {
          dispatchId: delivery.dispatchId,
          continuationKey: KEY,
          messageId: MESSAGE_ID,
          sessionId: SESSION_ID,
          eveTurnId: "turn_1",
          revision: 9,
          phase: "completed",
          text: "probe",
          activity: "",
        },
        {
          continuationKey: KEY,
          sessionId: SESSION_ID,
          messageId: MESSAGE_ID,
          dispatchId: delivery.dispatchId,
          eveTurnId: "turn_1",
        },
      );
      return settled !== undefined;
    }
    case "COMPLETE": {
      const status = await queue.complete({
        continuationKey: KEY,
        sessionId: SESSION_ID,
        messageId: MESSAGE_ID,
        dispatchId: delivery.dispatchId,
        eveTurnId: "turn_1",
      });
      return status === "completed";
    }
    default:
      // The remaining events are driven by the sweep or the lease rather than by
      // a single callable transition; covered by `check:invariants`.
      return (await readPhase()) !== before;
  }
}

/** Only the events with a callable Lua counterpart to compare against. */
const CASES: ReadonlyArray<{ readonly from: DeliveryPhaseValue; readonly event: DeliveryEvent }> = [
  { from: DeliveryPhase.Claimed, event: { type: "MARK_LIVE" } },
  { from: DeliveryPhase.Claimed, event: { type: "PARK" } },
  { from: DeliveryPhase.Claimed, event: { type: "COMPLETE" } },
  { from: DeliveryPhase.Live, event: { type: "MARK_LIVE" } },
  { from: DeliveryPhase.Live, event: { type: "PARK" } },
  { from: DeliveryPhase.Live, event: { type: "COMPLETE" } },
  { from: DeliveryPhase.Parked, event: { type: "PARK" } },
  { from: DeliveryPhase.Parked, event: { type: "COMPLETE" } },
];

let disagreements = 0;
console.info("spec vs lua — one row per (phase, event)\n");

for (const testCase of CASES) {
  const delivery = await arrange(testCase.from);
  if (delivery === undefined) {
    console.error(`   SKIP  could not arrange ${testCase.from}`);
    continue;
  }
  const before = (await readPhase()) ?? "(absent)";

  // `COMPLETE` is the one guarded on cross-machine state, so the context has to
  // reflect what Redis actually holds rather than an assumption.
  const outcome: unknown = await redis.get(`agent:render-outcome:${delivery.dispatchId}`);
  const context: DeliveryContext = {
    sessionId: before === DeliveryPhase.Claimed ? "" : SESSION_ID,
    renderSettled: outcome === "applied" || outcome === "discarded",
  };

  const spec = allowsDelivery(testCase.from, context, testCase.event);
  const happened = await attempt(testCase.event, delivery, before);
  const agrees = (spec !== undefined) === happened;
  if (!agrees) disagreements += 1;

  console.info(
    `   ${agrees ? "ok  " : "FAIL"} ${testCase.from.padEnd(18)} --${testCase.event.type.padEnd(16)}-->` +
      ` spec=${spec === undefined ? "refused" : spec.next.padEnd(7)} lua=${happened ? "moved" : "refused"}`,
  );
  if (!agrees) {
    console.error(
      spec === undefined
        ? "        lua allowed what the spec forbids — a guard is missing from the machine"
        : "        the spec allows what lua refuses — an undocumented fence",
    );
  }
  await scrub(delivery.dispatchId);
}

if (disagreements === 0) {
  console.info("\nthe machine and the lua agree on every case");
} else {
  console.error(`\n${disagreements} disagreement(s)`);
  process.exit(1);
}
