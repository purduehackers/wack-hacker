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

import {
  allowsDelivery,
  allowsRender,
  DeliveryPhase,
  RenderPhase,
} from "../src/conversations/machines/index.ts";
import type {
  DeliveryContext,
  DeliveryEvent,
  RenderContext,
  RenderEvent,
} from "../src/conversations/machines/index.ts";
import { StoredPhase } from "../src/conversations/records/delivery.ts";
import { DeliveryWriter } from "../src/conversations/writers/delivery.ts";
import { RenderWriter } from "../src/conversations/writers/render.ts";
import { redisEnv } from "../src/env/scripts.ts";
import { getRedis } from "../src/redis/client.ts";
import { Result } from "../src/result/index.ts";
import type { DeliveryPayload, MessagePayload, ParkedPayload, RenderIntent } from "../src/wire.ts";

const redis = getRedis(redisEnv());
const writer = new DeliveryWriter(redis);
const renders = new RenderWriter(redis);

/** Outside the range Discord mints, so it can never collide with real traffic. */
const KEY = "99999999999999901";
const MESSAGE_ID = "99999999999999900";
const SESSION_ID = "wrun_invariant_probe";

/** Only the fields the invariants below are stated in terms of. */
const activeRecordSchema = z.looseObject({
  phase: z.string(),
  turn: z.looseObject({ expiresAtMs: z.number() }).optional(),
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
/** The handoff holder, which `confirmSession` fences on. */
let claimToken = "";

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
 * The declared lifecycles, driven beside the real thing.
 *
 * `machines/` says which transitions are legal; Lua decides what happened. Those
 * two can drift silently — a guard tightened in one and not the other reads as a
 * conversation that mysteriously stops — so every step below advances both and
 * the phases are compared. Without this the tables are decoration.
 */
interface MachineState {
  delivery: DeliveryPhase;
  render: RenderPhase;
  deliveryContext: DeliveryContext;
  renderContext: RenderContext;
}

const machine: MachineState = {
  delivery: DeliveryPhase.Queued,
  render: RenderPhase.Unclaimed,
  deliveryContext: { sessionId: "", renderSettled: false },
  renderContext: { desiredRevision: 0, appliedRevision: 0, terminal: false },
};

/** Widened deliberately: the question is whether Redis holds a phase it may not. */
const STORED_PHASES: ReadonlySet<string> = new Set(StoredPhase.options);

/** Phases with no persisted form, so "no record" is the agreeing answer. */
const UNSTORED_PHASES: readonly DeliveryPhase[] = [
  DeliveryPhase.Queued,
  DeliveryPhase.Done,
  DeliveryPhase.Expired,
];

function resetMachine(): void {
  machine.delivery = DeliveryPhase.Queued;
  machine.render = RenderPhase.Unclaimed;
  machine.deliveryContext = { sessionId: "", renderSettled: false };
  machine.renderContext = { desiredRevision: 0, appliedRevision: 0, terminal: false };
}

/** What one step does to the tables, if anything. */
interface MachineStep {
  readonly delivery?: DeliveryEvent["type"];
  readonly render?: readonly RenderEvent["type"][];
  readonly deliveryContext?: Partial<DeliveryContext>;
  readonly renderContext?: Partial<RenderContext>;
}

function advanceMachine(step: MachineStep): readonly string[] {
  const violations: string[] = [];
  // Context first: a guard reads what the transition is about to be judged on.
  machine.deliveryContext = { ...machine.deliveryContext, ...step.deliveryContext };
  machine.renderContext = { ...machine.renderContext, ...step.renderContext };
  if (step.delivery !== undefined) {
    const allowed = allowsDelivery(machine.delivery, machine.deliveryContext, {
      type: step.delivery,
    });
    if (allowed === undefined) {
      violations.push(
        `M1 Redis performed ${step.delivery}, which the machine refuses from ${machine.delivery}`,
      );
    } else {
      machine.delivery = allowed.next;
    }
  }
  for (const event of step.render ?? []) {
    const allowed = allowsRender(machine.render, machine.renderContext, { type: event });
    if (allowed === undefined) {
      violations.push(
        `M2 Redis performed render ${event}, which the machine refuses from ${machine.render}`,
      );
    } else {
      machine.render = allowed.next;
    }
  }
  return violations;
}

/** Do the tables and Redis agree about where this delivery is? */
async function compareMachine(
  active: z.output<typeof activeRecordSchema> | undefined,
): Promise<readonly string[]> {
  const violations: string[] = [];
  const stored = active?.phase;
  if (stored === undefined) {
    if (!UNSTORED_PHASES.includes(machine.delivery)) {
      violations.push(`M3 the machine says ${machine.delivery}, but Redis holds no record`);
    }
  } else if (stored !== machine.delivery) {
    violations.push(`M3 the machine says ${machine.delivery}, Redis says ${stored}`);
  } else if (!STORED_PHASES.has(stored)) {
    violations.push(`M3 Redis persisted ${stored}, which has no persisted form`);
  }

  const dispatchId = claimed?.dispatchId;
  if (dispatchId !== undefined) {
    const outcome: unknown = await redis.get(`agent:render-outcome:${dispatchId}`);
    const recorded = outcome === "applied" || outcome === "discarded" ? outcome : undefined;
    const expected =
      machine.render === RenderPhase.Applied || machine.render === RenderPhase.Discarded
        ? machine.render
        : undefined;
    if (recorded !== expected) {
      violations.push(
        `M4 the render machine says ${expected ?? "no outcome"}, Redis says ${recorded ?? "no outcome"}`,
      );
    }
  }
  return violations;
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
  const violations: string[] = [...(await compareMachine(active))];
  if (pending > 0 && !inIndex)
    violations.push("I1 queued work is not in the index, so it never drains");
  if (active !== undefined && ttl === -1) violations.push("I2 the active record has no expiry");
  if (active !== undefined && active.turn === undefined) {
    violations.push("I3 the active record carries no lease for the sweep to read");
    // Worth naming, because it is the likeliest cause and looks nothing like it:
    // the current writer cannot produce this shape, so something else wrote it.
    // The probe advertises itself in the global queue index — it has to, that is
    // half of what I1 and I4 are about — so any process still running the
    // pre-rewrite claim will sweep it up and win the race.
    violations.push("     (a process running older code may be competing for the probe)");
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

interface Step {
  readonly name: string;
  readonly run: () => Promise<void>;
  /** What the declared lifecycles do when this step succeeds. */
  readonly machine?: MachineStep;
}

const steps: readonly Step[] = [
  { name: "enqueue", run: async () => writer.enqueue(message) },
  {
    name: "claim",
    run: async () => {
      const outcome = await writer.claim(KEY);
      if (Result.isError(outcome)) throw new Error(`claim failed: ${outcome.error.message}`);
      if (outcome.value === undefined) throw new Error("claim returned nothing");
      claimed = outcome.value.payload;
      claimToken = outcome.value.claimToken;
    },
    machine: { delivery: "CLAIM" },
  },
  {
    name: "admission.start",
    run: async () => {
      if (claimed === undefined) throw new Error("no claimed delivery");
      const started = await writer.markLive(KEY, claimed.dispatchId, MESSAGE_ID);
      if (started.status !== "start") throw new Error(`mark-live returned ${started.status}`);
    },
    machine: { delivery: "MARK_LIVE" },
  },
  {
    name: "admission.confirm",
    run: async () => {
      if (claimed === undefined) throw new Error("no claimed delivery");
      if (!(await writer.confirmSession(KEY, claimToken, SESSION_ID))) {
        throw new Error("confirm was rejected");
      }
    },
    machine: { delivery: "CONFIRM_SESSION", deliveryContext: { sessionId: SESSION_ID } },
  },
  {
    name: "publish(streaming)",
    run: async () => {
      if (claimed === undefined) throw new Error("no claimed delivery");
      const published = await renders.publish(intentFor(claimed.dispatchId, 1, "streaming"));
      if (!published.accepted) throw new Error("publish was rejected");
    },
    machine: { render: ["PUBLISH"], renderContext: { desiredRevision: 1, terminal: false } },
  },
  {
    name: "settleAndPark",
    run: async () => {
      if (claimed === undefined) throw new Error("no claimed delivery");
      const settled = await renders.settleAndPark(
        intentFor(claimed.dispatchId, 2, "completed"),
        parkedFor(claimed.dispatchId),
      );
      if (settled === undefined) throw new Error("settle was rejected");
    },
    machine: {
      delivery: "PARK",
      render: ["PUBLISH"],
      renderContext: { desiredRevision: 2, terminal: true },
    },
  },
  {
    // Stands in for the bot: `complete` refuses until the paint is recorded.
    name: "bot records the paint",
    run: async () => {
      if (claimed === undefined) throw new Error("no claimed delivery");
      await redis.set(`agent:render-outcome:${claimed.dispatchId}`, "applied");
    },
    machine: {
      render: ["CLAIM", "SETTLE"],
      renderContext: { appliedRevision: 2 },
      deliveryContext: { renderSettled: true },
    },
  },
  {
    name: "complete",
    run: async () => {
      if (claimed === undefined) throw new Error("no claimed delivery");
      const status = await writer.complete(parkedFor(claimed.dispatchId));
      if (status !== "completed") throw new Error(`complete returned ${status}`);
    },
    machine: { delivery: "COMPLETE" },
  },
];

let failures = 0;

console.info("happy path — invariants after every transition\n");
await scrub();
resetMachine();
for (const step of steps) {
  try {
    await step.run();
    // Advanced only on success: a step that threw did not happen in Redis
    // either, and moving the table anyway would manufacture a disagreement.
    for (const entry of advanceMachine(step.machine ?? {})) {
      console.error(`        ${entry}`);
      failures += 1;
    }
  } catch (cause) {
    console.error(
      `   FAIL ${step.name} threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    failures += 1;
  }
  failures += (await check(step.name)).length;
}

console.info("\ncrash injection — stop after step N, then ask whether the state is bounded\n");
for (let cut = 1; cut < steps.length; cut += 1) {
  await scrub();
  resetMachine();
  for (let index = 0; index < cut; index += 1) {
    const step = steps[index];
    if (step === undefined) continue;
    try {
      await step.run();
      failures += advanceMachine(step.machine ?? {}).length;
    } catch {
      // The crash under test; the invariants below are the assertion.
    }
  }
  failures += (await check(`crash after ${steps[cut - 1]?.name ?? "?"}`)).length;
  const active = await readActive();
  const remainingMs = await redis.pttl(`agent:active:${KEY}`);
  if (active !== undefined && active.turn === undefined && remainingMs === -1) {
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
