/** Coalesced Redis outbox consumer and sole Discord paint owner. */

import { serializeError, tagOf, Transient, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import type { RenderIntent, RenderTarget } from "@repo/shared/wire";

import { continueTrace, traceOperation } from "../../framework/observability.ts";
import { renderHitl } from "../hitl/components.ts";
import type { TurnMessageWriter } from "../turn-messages.ts";
import type { DiscordRest } from "./discord-rest.ts";
import { createRenderer } from "./renderer.ts";
import type { RendererProjection } from "./renderer.ts";
import type { RenderStore } from "./store.ts";

const MAX_CONCURRENT_RENDERS = 4;

export interface RenderCoordinatorDeps {
  readonly rest: DiscordRest;
  readonly store: RenderStore;
  readonly turnMessages: TurnMessageWriter;
  readonly reporter: Reporter;
  /** Re-checks parked markers after a terminal render reaches an outcome. */
  readonly onOutcome?: () => Promise<void> | void;
  readonly recoveryIntervalMs?: number;
}

interface RenderWork {
  readonly intent: RenderIntent;
  readonly target: RenderTarget;
  readonly projection: RendererProjection;
  readonly appliedRevision: number;
}

function reportFailure(
  deps: RenderCoordinatorDeps,
  dispatchId: string,
  operation: string,
  error: unknown,
): void {
  const serialized = serializeError(error);
  deps.reporter.emit({
    op: operation,
    status: "error",
    errorTag: tagOf(error),
    errorMessage: serialized.message,
    attributes: { dispatchId },
  });
}

async function discardDefect(
  deps: RenderCoordinatorDeps,
  dispatchId: string,
  operation: string,
  error: unknown,
): Promise<undefined> {
  deps.reporter.captureDefect(error, { op: operation, attributes: { dispatchId } });
  const serialized = serializeError(error);
  deps.reporter.emit({
    op: operation,
    status: "defect",
    errorTag: tagOf(error),
    errorMessage: serialized.message,
    attributes: { dispatchId },
  });
  await deps.store.discard(dispatchId);
  return undefined;
}

function toProjection(value: {
  readonly anchorMessageId?: string | undefined;
  readonly anchorContentHash?: string | undefined;
  readonly overflow: readonly {
    readonly messageId: string;
    readonly contentHash?: string | undefined;
  }[];
}): RendererProjection {
  return {
    ...(value.anchorMessageId === undefined ? {} : { anchorMessageId: value.anchorMessageId }),
    ...(value.anchorContentHash === undefined
      ? {}
      : { anchorContentHash: value.anchorContentHash }),
    overflow: value.overflow.map((item) => ({
      messageId: item.messageId,
      ...(item.contentHash === undefined ? {} : { contentHash: item.contentHash }),
    })),
  };
}

async function loadWork(
  deps: RenderCoordinatorDeps,
  dispatchId: string,
): Promise<RenderWork | undefined> {
  const desired = await deps.store.intent(dispatchId);
  if (Result.isError(desired)) {
    return discardDefect(deps, dispatchId, "agent.render.decode-intent", desired.error);
  }
  if (desired.value === undefined) {
    await deps.store.discard(dispatchId);
    return undefined;
  }

  const targetResult = await deps.store.target(dispatchId);
  if (Result.isError(targetResult)) {
    return discardDefect(deps, dispatchId, "agent.render.decode-target", targetResult.error);
  }
  const target = targetResult.value;
  if (target === undefined) {
    return discardDefect(
      deps,
      dispatchId,
      "agent.render.target",
      new Error("render intent has no immutable bot target"),
    );
  }

  const intent = desired.value;
  if (
    target.dispatchId !== intent.dispatchId ||
    target.continuationKey !== intent.continuationKey ||
    target.messageId !== intent.messageId
  ) {
    return discardDefect(
      deps,
      dispatchId,
      "agent.render.target-mismatch",
      new Error("render intent does not match its bot target"),
    );
  }

  const loaded = await deps.store.projection(dispatchId, target.anchorMessageId);
  if (Result.isError(loaded)) {
    return discardDefect(deps, dispatchId, "agent.render.decode-projection", loaded.error);
  }
  return {
    intent,
    target,
    projection: toProjection(loaded.value),
    appliedRevision: loaded.value.appliedRevision,
  };
}

async function indexTurn(
  deps: RenderCoordinatorDeps,
  dispatchId: string,
  work: RenderWork,
): Promise<boolean> {
  const ids = [
    work.projection.anchorMessageId,
    ...work.projection.overflow.map((item) => item.messageId),
  ];
  for (const id of ids) {
    if (id === undefined) continue;
    const indexed = await deps.turnMessages.record(id, {
      sessionId: work.intent.sessionId,
      eveTurnId: work.intent.eveTurnId,
      requesterUserId: work.target.requesterUserId,
    });
    if (Result.isError(indexed)) {
      reportFailure(deps, dispatchId, "agent.render.index", indexed.error);
      return false;
    }
  }
  return true;
}

async function paint(
  deps: RenderCoordinatorDeps,
  dispatchId: string,
  claimToken: string,
  work: RenderWork,
): Promise<boolean> {
  if (work.appliedRevision >= work.intent.revision) return true;

  const renderer = createRenderer(
    {
      rest: deps.rest,
      channelId: work.target.channelId,
      sourceMessageId: work.target.messageId,
      ...(work.target.replyToMessageId === undefined
        ? {}
        : { replyToMessageId: work.target.replyToMessageId }),
      checkpoint: (state) =>
        deps.store.checkpoint(dispatchId, claimToken, state, work.appliedRevision),
      verifyLease: () => deps.store.renew(dispatchId, claimToken),
    },
    work.projection,
  );
  const hitl = work.intent.phase === "streaming" ? renderHitl(work.intent) : undefined;
  const painted = await renderer.write({
    text: work.intent.text,
    activity: work.intent.activity,
    ...(work.intent.footer === undefined ? {} : { footer: work.intent.footer }),
    ...(hitl?.notice === undefined ? {} : { notice: hitl.notice }),
    ...(hitl === undefined ? {} : { components: hitl.components }),
    terminal: work.intent.phase !== "streaming",
  });
  if (Result.isError(painted)) {
    reportFailure(deps, dispatchId, "agent.render.paint", painted.error);
    if (
      painted.error instanceof UpstreamError &&
      painted.error.status >= 400 &&
      painted.error.status < 500 &&
      painted.error.status !== 404
    ) {
      await deps.store.discard(dispatchId);
    }
    return false;
  }
  return work.intent.phase === "streaming" || indexTurn(deps, dispatchId, work);
}

async function applyLatest(
  deps: RenderCoordinatorDeps,
  dispatchId: string,
): Promise<"done" | "newer"> {
  const claimToken = await deps.store.claim(dispatchId);
  if (claimToken === undefined) return "done";

  const startedAt = Date.now();
  let releaseClaim = true;
  try {
    const work = await loadWork(deps, dispatchId);
    if (work === undefined) return "done";
    const result = await continueTrace(work.intent.traceparent, () =>
      traceOperation(
        "agent.render.apply",
        async () => {
          if (!(await paint(deps, dispatchId, claimToken, work))) return "done";

          const completion = await deps.store.complete(
            dispatchId,
            claimToken,
            work.projection,
            Math.max(work.appliedRevision, work.intent.revision),
            work.intent.phase !== "streaming",
          );
          releaseClaim = false;
          if (completion === "lost") {
            reportFailure(
              deps,
              dispatchId,
              "agent.render.complete",
              new Transient({
                operation: "complete Discord render",
                detail: "render lease was lost",
              }),
            );
            return "done";
          }
          deps.reporter.emit({
            op: "agent.render.apply",
            status: "ok",
            durationMs: Date.now() - startedAt,
            attributes: {
              dispatchId,
              phase: work.intent.phase,
              revision: work.intent.revision,
              completion,
            },
          });
          return completion === "newer" ? "newer" : "done";
        },
        { "agent.dispatch.id": dispatchId, "agent.render.phase": work.intent.phase },
      ),
    );
    return result;
  } finally {
    if (releaseClaim) await deps.store.release(dispatchId, claimToken).catch(() => undefined);
  }
}

async function drainWorkers(running: ReadonlyMap<string, Promise<void>>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, 15_000);
    timer.unref();
  });
  await Promise.race([Promise.allSettled(running.values()), timeout]);
  if (timer !== undefined) clearTimeout(timer);
}

type OutcomeWaiter = (settled: boolean) => void;

function createOutcomeBarrier(deps: RenderCoordinatorDeps, kick: (dispatchId: string) => void) {
  const waitersByDispatch = new Map<string, Set<OutcomeWaiter>>();
  const runningChecks = new Map<string, Promise<void>>();

  const resolve = (dispatchId: string): Promise<void> => {
    const runningCheck = runningChecks.get(dispatchId);
    if (runningCheck !== undefined) return runningCheck;

    const check = (async (): Promise<void> => {
      if ((await deps.store.outcome(dispatchId)) === undefined) return;
      for (const waiter of waitersByDispatch.get(dispatchId) ?? []) waiter(true);
      waitersByDispatch.delete(dispatchId);
      await deps.onOutcome?.();
    })();
    runningChecks.set(dispatchId, check);
    const clean = (): void => {
      if (runningChecks.get(dispatchId) === check) runningChecks.delete(dispatchId);
    };
    void check.then(clean, clean);
    return check;
  };

  return {
    resolve,
    wait: async (dispatchId: string): Promise<boolean> => {
      if ((await deps.store.outcome(dispatchId)) !== undefined) return true;
      return new Promise<boolean>((settle) => {
        const waiters = waitersByDispatch.get(dispatchId) ?? new Set();
        let timer: ReturnType<typeof setTimeout>;
        const finish = (visible: boolean): void => {
          clearTimeout(timer);
          waiters.delete(finish);
          if (waiters.size === 0) waitersByDispatch.delete(dispatchId);
          settle(visible);
        };
        waiters.add(finish);
        waitersByDispatch.set(dispatchId, waiters);
        timer = setTimeout(() => finish(false), 35_000);
        timer.unref();
        kick(dispatchId);
        // Closes the outcome-written-before-waiter-registration race.
        void resolve(dispatchId).catch((cause: unknown) => {
          deps.reporter.captureDefect(cause, { op: "agent.render.flush" });
        });
      });
    },
    stop: (): void => {
      for (const resolvers of waitersByDispatch.values()) {
        for (const settle of resolvers) settle(false);
      }
      waitersByDispatch.clear();
    },
  };
}

export function createRenderCoordinator(deps: RenderCoordinatorDeps) {
  let started = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const pending = new Set<string>();
  const running = new Map<string, Promise<void>>();
  const outcomes = createOutcomeBarrier(deps, kick);

  const run = async (dispatchId: string): Promise<void> => {
    try {
      do {
        pending.delete(dispatchId);
        if ((await applyLatest(deps, dispatchId)) === "newer") pending.add(dispatchId);
        await outcomes.resolve(dispatchId);
      } while (!stopped && pending.has(dispatchId));
    } catch (cause) {
      reportFailure(deps, dispatchId, "agent.render.consume", cause);
    } finally {
      running.delete(dispatchId);
      pump();
    }
  };

  function pump(): void {
    if (!started || stopped) return;
    for (const dispatchId of pending) {
      if (running.size >= MAX_CONCURRENT_RENDERS) return;
      if (running.has(dispatchId)) continue;
      const worker = run(dispatchId);
      running.set(dispatchId, worker);
    }
  }

  function kick(dispatchId: string): void {
    if (stopped) return;
    pending.add(dispatchId);
    pump();
  }

  const sweep = async (): Promise<void> => {
    if (stopped) return;
    for (const dispatchId of await deps.store.ready()) kick(dispatchId);
  };

  return {
    kick,
    sweep,

    /** Holds queue advancement until terminal Discord paint applied or dead-lettered. */
    flush: outcomes.wait,

    /** Called only once the Discord client is ready and its REST token is set. */
    start: async (): Promise<void> => {
      if (started || stopped) return;
      started = true;
      await sweep();
      const recoveryIntervalMs = deps.recoveryIntervalMs ?? 60_000;
      if (recoveryIntervalMs <= 0) return;
      timer = setInterval(() => {
        void sweep().catch((cause: unknown) => {
          deps.reporter.captureDefect(cause, { op: "agent.render.recovery" });
        });
      }, recoveryIntervalMs);
      timer.unref();
    },

    stop: async (): Promise<void> => {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      pending.clear();
      outcomes.stop();
      await drainWorkers(running);
    },
  };
}

export type RenderCoordinator = ReturnType<typeof createRenderCoordinator>;
