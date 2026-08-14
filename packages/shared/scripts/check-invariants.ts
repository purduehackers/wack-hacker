#!/usr/bin/env bun

/**
 * @fileoverview Does the control plane still hold together?
 *
 * Drives one delivery through the real Lua — enqueue, claim, admission, render,
 * park, complete — checking every invariant after every transition. Then it cuts
 * the sequence short at each step in turn, which is what a crash actually looks
 * like. Afterwards it asks the only question that matters: is the state bounded,
 * or has this conversation been taken hostage.
 *
 * The properties are not type-level, so nothing but this checks them.
 *
 * Uses a synthetic conversation key, scrubbed on the way in and out, so it is
 * safe to point at any environment.
 */

import { Result } from "@repo/shared/result";
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
import {
  InvariantViolated,
  messageOf,
  NotFound,
  serializeError,
  Transient,
} from "../src/errors.ts";
import type { InvalidInput } from "../src/errors.ts";
import { stored } from "../src/json.ts";
import { getRedis } from "../src/redis/client.ts";
import type { DeliveryPayload, MessagePayload, ParkedPayload, RenderIntent } from "../src/wire.ts";
import { finish } from "./probe.ts";

const redis = getRedis(redisEnv());
const writer = new DeliveryWriter(redis);
const renders = new RenderWriter(redis);

/** Outside the range Discord mints, so it can never collide with real traffic. */
const KEY = "99999999999999901";
const MESSAGE_ID = "99999999999999900";
const SESSION_ID = "wrun_invariant_probe";

/** Only the fields this script states the invariants in terms of. */
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

/** The delivery the claim handed back. Every later step uses its id as the fence. */
let claimed: DeliveryPayload | undefined;
/** Every step after the claim needs this, and none of them can run without it. */
function dispatchId(): Result<string, NotFound> {
  return claimed === undefined
    ? Result.err(new NotFound({ kind: "claimed delivery", id: KEY }))
    : Result.ok(claimed.dispatchId);
}

async function readActive(): Promise<z.output<typeof activeRecordSchema> | undefined> {
  const raw: unknown = await redis.get(`agent:active:${KEY}`);
  return stored(activeRecordSchema).safeParse(raw).data;
}

async function scrub(): Promise<void> {
  const dispatchId = claimed?.dispatchId;
  await redis.del(
    `agent:active:${KEY}`,
    `pending:${KEY}`,
    `agent:parked:${KEY}`,
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
 * `machines/` says which transitions are legal. Lua decides what happened. The
 * two can drift silently — a guard tightened in one and not the other reads as
 * a conversation that mysteriously stops. So every step advances both and
 * compares the phases. Without this the tables are decoration.
 */
interface MachineState {
  delivery: DeliveryPhase;
  render: RenderPhase;
  deliveryContext: DeliveryContext;
  renderContext: RenderContext;
}

function freshMachine(): MachineState {
  return {
    delivery: DeliveryPhase.Queued,
    render: RenderPhase.Unclaimed,
    deliveryContext: { sessionId: "", renderSettled: false },
    renderContext: { desiredRevision: 0, appliedRevision: 0, terminal: false },
  };
}

let machine = freshMachine();

/** Widened deliberately: the question is whether Redis holds a phase it may not. */
const STORED_PHASES: ReadonlySet<string> = new Set(StoredPhase.options);

/**
 * Printed beside a violation rather than instead of it. The invariant really was
 * broken. Naming the likeliest third party turns twenty minutes of reading Lua
 * into one re-run after a deploy.
 */
const FOREIGN_WRITER = "     (a process running older code may be competing for the probe)";

/** Phases with no persisted form, so "no record" is the agreeing answer. */
const UNSTORED_PHASES: readonly DeliveryPhase[] = [
  DeliveryPhase.Queued,
  DeliveryPhase.Done,
  DeliveryPhase.Expired,
];

/** What one step does to the tables, if anything. */
interface MachineStep {
  readonly delivery?: DeliveryEvent["type"];
  readonly render?: readonly RenderEvent["type"][];
  readonly deliveryContext?: Partial<DeliveryContext>;
  readonly renderContext?: Partial<RenderContext>;
}

function advanceMachine(step: MachineStep): readonly string[] {
  const violations: string[] = [];
  // Context first: a guard judges the transition on the context it reads here.
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
      machine.delivery = allowed;
    }
  }
  for (const event of step.render ?? []) {
    const allowed = allowsRender(machine.render, machine.renderContext, { type: event });
    if (allowed === undefined) {
      violations.push(
        `M2 Redis performed render ${event}, which the machine refuses from ${machine.render}`,
      );
    } else {
      machine.render = allowed;
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
      // This probe is the only legitimate writer of its conversation, so somebody
      // else deleted any record that vanishes under it — and it has to advertise
      // itself in the global indexes for I1 and I4 to mean anything.
      violations.push(FOREIGN_WRITER);
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
async function check(label: string): Promise<number> {
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
    // The current writer cannot produce this shape, so something else wrote it.
    violations.push(FOREIGN_WRITER);
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
  return violations.length;
}

/** One failure a step can produce. The runner treats them all alike. */
type StepFailure = InvalidInput | InvariantViolated | NotFound | Transient;

interface Step {
  readonly name: string;
  readonly run: () => Promise<Result<unknown, StepFailure>>;
  /** What the declared lifecycles do when this step succeeds. */
  readonly machine?: MachineStep;
}

/**
 * Runs one control-plane call. A rejection maps into the step's failure
 * channel, so a Redis outage reads as a failed step rather than a crash.
 */
function attempt<T>(operation: string, run: () => Promise<T>): Promise<Result<T, Transient>> {
  return Result.tryPromise({
    try: run,
    catch: (cause) => new Transient({ operation, detail: messageOf(cause) }),
  });
}

const steps: readonly Step[] = [
  { name: "enqueue", run: () => attempt("enqueue", () => writer.enqueue(message)) },
  {
    name: "claim",
    run: () =>
      Result.gen(async function* () {
        const outcome = yield* Result.await(attempt("claim", () => writer.claim(KEY)));
        const delivery = yield* outcome;
        if (delivery === undefined) {
          return Result.err(
            new InvariantViolated({
              invariant: "claim hands back the enqueued delivery",
              detail: "claim returned nothing",
            }),
          );
        }
        claimed = delivery.payload;
        return Result.ok();
      }),
    machine: { delivery: "CLAIM" },
  },
  {
    name: "admission.start",
    run: () =>
      Result.gen(async function* () {
        const id = yield* dispatchId();
        const started = yield* Result.await(
          attempt("mark-live", () => writer.markLive(KEY, id, MESSAGE_ID)),
        );
        return started.status === "start"
          ? Result.ok()
          : Result.err(
              new InvariantViolated({
                invariant: "admission starts the claimed delivery",
                detail: `mark-live returned ${started.status}`,
              }),
            );
      }),
    machine: { delivery: "MARK_LIVE" },
  },
  {
    name: "admission.confirm",
    run: () =>
      Result.gen(async function* () {
        const id = yield* dispatchId();
        const confirmed = yield* Result.await(
          attempt("confirm-session", () => writer.confirmSession(KEY, id, MESSAGE_ID, SESSION_ID)),
        );
        return confirmed
          ? Result.ok()
          : Result.err(
              new InvariantViolated({
                invariant: "admission confirms the live session",
                detail: "confirm was rejected",
              }),
            );
      }),
    machine: { delivery: "CONFIRM_SESSION", deliveryContext: { sessionId: SESSION_ID } },
  },
  {
    name: "publish(streaming)",
    run: () =>
      Result.gen(async function* () {
        const id = yield* dispatchId();
        const published = yield* Result.await(
          attempt("publish", () => renders.publish(intentFor(id, 1, "streaming"))),
        );
        return published.accepted
          ? Result.ok()
          : Result.err(
              new InvariantViolated({
                invariant: "a live turn accepts its first render",
                detail: "publish was rejected",
              }),
            );
      }),
    machine: { render: ["PUBLISH"], renderContext: { desiredRevision: 1, terminal: false } },
  },
  {
    name: "settleAndPark",
    run: () =>
      Result.gen(async function* () {
        const id = yield* dispatchId();
        const settled = yield* Result.await(
          attempt("settle-and-park", () =>
            renders.settleAndPark(intentFor(id, 2, "completed"), parkedFor(id)),
          ),
        );
        return settled === undefined
          ? Result.err(
              new InvariantViolated({
                invariant: "a live turn settles and parks",
                detail: "settle was rejected",
              }),
            )
          : Result.ok();
      }),
    machine: {
      delivery: "PARK",
      render: ["PUBLISH"],
      renderContext: { desiredRevision: 2, terminal: true },
    },
  },
  {
    // Stands in for the bot: `complete` refuses until the bot records the paint.
    name: "bot records the paint",
    run: () =>
      Result.gen(async function* () {
        const id = yield* dispatchId();
        yield* Result.await(
          attempt("record-paint", () => redis.set(`agent:render-outcome:${id}`, "applied")),
        );
        return Result.ok();
      }),
    machine: {
      render: ["CLAIM", "SETTLE"],
      renderContext: { appliedRevision: 2 },
      deliveryContext: { renderSettled: true },
    },
  },
  {
    name: "complete",
    run: () =>
      Result.gen(async function* () {
        const id = yield* dispatchId();
        const status = yield* Result.await(
          attempt("complete", () => writer.complete(parkedFor(id))),
        );
        return status === "completed"
          ? Result.ok()
          : Result.err(
              new InvariantViolated({
                invariant: "a parked delivery completes once painted",
                detail: `complete returned ${status}`,
              }),
            );
      }),
    machine: { delivery: "COMPLETE" },
  },
];

let failures = 0;

function fail(...lines: readonly string[]): void {
  for (const line of lines) console.error(`        ${line}`);
  failures += lines.length;
}

/**
 * A step that fails mid-sequence is the crash under test. One that fails on the
 * happy path is a failure. Either way the tables only advance on success, because
 * a step that failed did not happen in Redis either.
 */
type OnFailure = "announce" | "expected";

async function runStep(step: Step, onFailure: OnFailure): Promise<void> {
  const outcome = await step.run();
  if (Result.isError(outcome)) {
    if (onFailure === "announce") fail(`${step.name} failed: ${messageOf(outcome.error)}`);
    return;
  }
  fail(...advanceMachine(step.machine ?? {}));
}

async function restart(): Promise<void> {
  await scrub();
  machine = freshMachine();
}

const verdict = await Result.gen(async function* () {
  console.info("happy path — invariants after every transition\n");
  yield* Result.await(attempt("restart", restart));
  for (const step of steps) {
    await runStep(step, "announce");
    failures += await check(step.name);
  }

  console.info("\ncrash injection — stop after step N, then ask whether the state is bounded\n");
  for (let cut = 1; cut < steps.length; cut += 1) {
    yield* Result.await(attempt("restart", restart));
    for (const step of steps.slice(0, cut)) await runStep(step, "expected");

    // Boundedness is I2 and I3 inside `check`, which runs on the line above: a
    // record with no expiry, or with no lease for the sweep to read, is already a
    // reported violation. A second test for both at once could only ever fire when
    // those two had, so it asserted nothing.
    failures += await check(`crash after ${steps[cut - 1]?.name ?? "?"}`);
  }

  yield* Result.await(attempt("scrub", scrub));
  return Result.ok(failures);
});

verdict.match({
  ok: (total) => finish(total, "all invariants hold across every path"),
  err: (error) => {
    const { tag, message: detail } = serializeError(error);
    console.error(`\nprobe could not run: ${tag}: ${detail}`);
    process.exit(1);
  },
});
