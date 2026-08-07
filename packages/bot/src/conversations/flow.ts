/** The bot's single reconciler for queueing, rendering, HITL, reset, and schedules. */

import type { ConversationStore, HitlClaimInput } from "@repo/shared/conversations";
import {
  RecoveryRequired,
  serializeError,
  tagOf,
  Transient,
  UpstreamError,
} from "@repo/shared/errors";
import type { KnownError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import type {
  InteractionPayload,
  MessagePayload,
  ParkedPayload,
  RenderIntent,
  RenderTarget,
  ResetPayload,
  ScheduledFirePayload,
} from "@repo/shared/wire";

import type { AgentClient, AgentError } from "../agent/client.ts";
import { renderHitl } from "../agent/hitl/components.ts";
import type { DiscordRest } from "../agent/render/discord-rest.ts";
import { createRenderer } from "../agent/render/renderer.ts";
import type { RendererProjection } from "../agent/render/renderer.ts";
import type { ScheduledDiscordAdapter } from "../agent/scheduled.ts";
import type { TurnMessageWriter } from "../agent/turn-messages.ts";
import { continueTrace, traceOperation } from "../framework/observability.ts";

const MAX_CONCURRENT_RENDERS = 4;

export interface ConversationFlowDeps {
  readonly eve: AgentClient;
  readonly store: ConversationStore;
  readonly rest: DiscordRest;
  readonly turnMessages: TurnMessageWriter;
  readonly schedules: ScheduledDiscordAdapter;
  readonly reporter: Reporter;
  readonly recoveryIntervalMs?: number;
}

export interface ConversationAnswer {
  readonly claim: HitlClaimInput;
  readonly payload: InteractionPayload;
}

export type ConversationAnswerResult =
  | { readonly status: "accepted" }
  | { readonly status: "claimed" | "stale" }
  | { readonly status: "failed"; readonly error: AgentError };

interface RenderWork {
  readonly intent: RenderIntent;
  readonly target: RenderTarget;
  readonly projection: RendererProjection;
  readonly appliedRevision: number;
}

function reportFailure(
  deps: ConversationFlowDeps,
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
  deps: ConversationFlowDeps,
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
  await deps.store.render.discard(dispatchId);
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
  deps: ConversationFlowDeps,
  dispatchId: string,
): Promise<RenderWork | undefined> {
  const desired = await deps.store.render.intent(dispatchId);
  if (Result.isError(desired)) {
    return discardDefect(deps, dispatchId, "agent.render.decode-intent", desired.error);
  }
  if (desired.value === undefined) {
    await deps.store.render.discard(dispatchId);
    return undefined;
  }

  const targetResult = await deps.store.render.target(dispatchId);
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

  const loaded = await deps.store.render.projection(dispatchId, target.anchorMessageId);
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
  deps: ConversationFlowDeps,
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
  deps: ConversationFlowDeps,
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
        deps.store.render.checkpoint(dispatchId, claimToken, state, work.appliedRevision),
      verifyLease: () => deps.store.render.renew(dispatchId, claimToken),
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
      await deps.store.render.discard(dispatchId);
    }
    return false;
  }
  return work.intent.phase === "streaming" || indexTurn(deps, dispatchId, work);
}

async function applyLatest(
  deps: ConversationFlowDeps,
  dispatchId: string,
): Promise<"done" | "newer"> {
  const claimToken = await deps.store.render.claim(dispatchId);
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

          const completion = await deps.store.render.complete(
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
    if (releaseClaim)
      await deps.store.render.release(dispatchId, claimToken).catch(() => undefined);
  }
}

function reportPendingRender(deps: ConversationFlowDeps, payload: ParkedPayload): void {
  deps.reporter.emit({
    op: "agent.router.parked",
    status: "error",
    errorTag: "Transient",
    errorMessage: "terminal Discord render is still pending",
    attributes: {
      continuationKey: payload.continuationKey,
      dispatchId: payload.dispatchId,
    },
  });
}

export interface ConversationWake {
  readonly dispatchId?: string;
  readonly continuationKey?: string;
}

export interface ConversationFlow {
  submit(payload: MessagePayload): Promise<Result<void, AgentError>>;
  reset(payload: ResetPayload): Promise<Result<void, KnownError>>;
  answer(answer: ConversationAnswer): Promise<ConversationAnswerResult>;
  admitSchedule(payload: ScheduledFirePayload): Promise<void>;
  wake(hint?: ConversationWake): void;
  sweep(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// oxlint-disable-next-line oxclippy/too-many-lines -- one closure owns the reconciler lifecycle
export function createConversationFlow(deps: ConversationFlowDeps): ConversationFlow {
  const pendingDispatches = new Set<string>();
  const pendingContinuations = new Set<string>();
  let stopped = false;
  let started = false;
  let sweepRequested = false;
  let sweepScheduled = false;
  let sweepRunning: Promise<void> | undefined;
  let recoveryTimer: ReturnType<typeof setInterval> | undefined;

  async function kick(continuationKey: string): Promise<AgentError | undefined> {
    const next = await deps.store.queue.claim(continuationKey);
    if (Result.isError(next)) {
      deps.reporter.captureDefect(next.error, {
        op: "agent.router.claim",
        attributes: { continuationKey },
      });
      return;
    }

    const claimed = next.value;
    if (claimed === undefined) return;
    const sent = await deps.eve.sendMessage(claimed.payload);
    if (Result.isOk(sent)) {
      // The Eve confirmation and this acknowledgement cover different crash
      // windows. A fast park can consume the claim before this CAS arrives.
      await deps.store.queue.confirm(continuationKey, claimed.claimToken, sent.value.sessionId);
      return;
    }

    deps.reporter.emit({
      op: "agent.router.send",
      status: "error",
      errorTag: tagOf(sent.error),
      errorMessage: sent.error.message,
      attributes: {
        continuationKey,
        messageId: claimed.payload.messageId,
        dispatchId: claimed.payload.dispatchId,
      },
    });
    return sent.error;
  }

  async function submit(payload: MessagePayload): Promise<Result<void, AgentError>> {
    const submitted = await Result.tryPromise({
      try: async () => {
        await deps.store.queue.enqueue(payload);
        return stopped ? undefined : kick(payload.continuationKey);
      },
      catch: (cause) =>
        new Transient({
          operation: "agent.router.submit",
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
    });
    if (Result.isError(submitted)) return submitted;
    return submitted.value === undefined ? Result.ok(undefined) : Result.err(submitted.value);
  }

  async function resetConversation(payload: ResetPayload): Promise<Result<void, KnownError>> {
    const prepared = await Result.tryPromise({
      try: () => deps.store.queue.beginReset(payload.continuationKey),
      catch: (cause) =>
        new Transient({
          operation: "agent.router.begin-reset",
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
    });
    if (Result.isError(prepared)) return prepared;

    const resetId = prepared.value;
    const reset = await deps.eve.sendReset({ ...payload, resetId });
    // An ambiguous remote result keeps the barrier installed. A later reset
    // reuses the same id and safely finishes or retries the cutover.
    if (Result.isError(reset)) return reset;

    const committed = await Result.tryPromise({
      try: () => deps.store.queue.commitReset(payload.continuationKey, resetId),
      catch: (cause) =>
        new Transient({
          operation: "agent.router.commit-reset",
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
    });
    if (Result.isError(committed)) return committed;
    return committed.value
      ? Result.ok(undefined)
      : Result.err(
          new Transient({
            operation: "agent.router.commit-reset",
            detail: "reset cutover ownership was lost",
          }),
        );
  }

  async function onParked(payload: ParkedPayload): Promise<void> {
    if (stopped) return;
    const outcome = await deps.store.render.outcome(payload.dispatchId);
    if (outcome === undefined) {
      pendingDispatches.add(payload.dispatchId);
      reportPendingRender(deps, payload);
      return;
    }
    if (stopped) return;

    const status = await deps.store.queue.complete(payload);
    deps.reporter.emit({
      op: "agent.router.parked",
      status: "ok",
      attributes: {
        continuationKey: payload.continuationKey,
        messageId: payload.messageId,
        dispatchId: payload.dispatchId,
        sessionId: payload.sessionId,
        completion: status,
      },
    });
    if (status === "pending") {
      pendingDispatches.add(payload.dispatchId);
      reportPendingRender(deps, payload);
      return;
    }
    if (status === "completed") await kick(payload.continuationKey);
  }

  async function recoverActiveQueues(): Promise<void> {
    if (stopped) return;
    for (const continuationKey of await deps.store.queue.keys()) {
      const recovery = await deps.store.queue.recoverAdmission(continuationKey);
      if (Result.isError(recovery)) {
        deps.reporter.captureDefect(recovery.error, {
          op: "agent.router.recover-admission",
          attributes: { continuationKey },
        });
        continue;
      }
      if (recovery.value !== undefined) {
        const error = new RecoveryRequired({
          operation: "agent delivery admission",
          detail: "the admission lease expired before Eve acknowledgement was durable",
          remediation: "reset the conversation before retrying",
        });
        deps.reporter.emit({
          op: "agent.router.recover-admission",
          status: "error",
          errorTag: error._tag,
          errorMessage: error.message,
          attributes: {
            continuationKey,
            messageId: recovery.value.messageId,
            dispatchId: recovery.value.dispatchId,
          },
        });
      }
      await kick(continuationKey);
    }
  }

  async function reconcileParked(): Promise<void> {
    const keys = new Set(await deps.store.queue.readyKeys());
    for (const continuationKey of pendingContinuations) keys.add(continuationKey);
    pendingContinuations.clear();
    for (const continuationKey of keys) {
      const parked = await deps.store.queue.parked(continuationKey);
      if (Result.isError(parked)) {
        deps.reporter.captureDefect(parked.error, {
          op: "agent.router.recover-marker",
          attributes: { continuationKey },
        });
        continue;
      }
      if (parked.value !== undefined) await onParked(parked.value);
    }
  }

  async function renderDispatches(): Promise<void> {
    const ready = new Set(await deps.store.render.ready());
    for (const dispatchId of pendingDispatches) ready.add(dispatchId);
    pendingDispatches.clear();
    const dispatches = [...ready];
    let cursor = 0;

    async function worker(): Promise<void> {
      while (cursor < dispatches.length && !stopped) {
        const dispatchId = dispatches[cursor++];
        if (dispatchId === undefined) return;
        try {
          while ((await applyLatest(deps, dispatchId)) === "newer" && !stopped) {
            // Drain revisions that arrived while the previous one was painted.
          }
        } catch (error) {
          reportFailure(deps, dispatchId, "agent.render.worker", error);
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_RENDERS, dispatches.length) }, worker),
    );
  }

  async function sweepOnce(): Promise<void> {
    // Render first so a durable terminal outcome is present before the queue
    // transition tries to advance past the parked delivery.
    await renderDispatches();
    await reconcileParked();
    await recoverActiveQueues();
  }

  async function drainSweeps(): Promise<void> {
    if (sweepRunning) return sweepRunning;
    sweepRunning = (async () => {
      do {
        sweepRequested = false;
        await sweepOnce();
      } while (sweepRequested && !stopped);
    })().finally(() => {
      sweepRunning = undefined;
      if (sweepRequested && !stopped) scheduleSweep();
    });
    return sweepRunning;
  }

  function scheduleSweep(): void {
    sweepRequested = true;
    if (!started || stopped || sweepScheduled) return;
    sweepScheduled = true;
    queueMicrotask(() => {
      sweepScheduled = false;
      void drainSweeps().catch((cause: unknown) => {
        deps.reporter.captureDefect(cause, { op: "agent.router.recovery" });
      });
    });
  }

  return {
    submit,
    reset: async (payload) => {
      const reset = await resetConversation(payload);
      if (Result.isOk(reset) && !stopped) await kick(payload.continuationKey);
      return reset;
    },
    answer: async ({ claim, payload }) => {
      const claimed = await deps.store.hitl.claim(claim);
      if (claimed !== "acquired") return { status: claimed };
      const sent = await deps.eve.sendInteraction(payload);
      if (Result.isError(sent)) return { status: "failed", error: sent.error };
      const completed = await deps.store.hitl.complete(
        claim.dispatchId,
        claim.revision,
        claim.interactionId,
      );
      if (!completed) {
        deps.reporter.captureDefect(new Error("accepted HITL claim could not be completed"), {
          op: "agent.hitl.complete",
          attributes: { dispatchId: claim.dispatchId, interactionId: claim.interactionId },
        });
      }
      return { status: "accepted" };
    },
    admitSchedule: async (payload) => {
      const claimToken = crypto.randomUUID();
      const claim = await deps.store.scheduledFires.claim(payload, claimToken);
      if (claim === "accepted") return;
      if (claim === "busy") throw new Error("scheduled occurrence is already being admitted");
      try {
        await deps.schedules.admit(payload, submit);
        if (!(await deps.store.scheduledFires.complete(payload, claimToken))) {
          throw new Error("scheduled occurrence admission receipt ownership was lost");
        }
      } catch (cause) {
        await deps.store.scheduledFires
          .release(payload.occurrenceId, claimToken)
          .catch((releaseCause: unknown) =>
            console.warn("could not release scheduled occurrence claim", releaseCause),
          );
        throw cause;
      }
    },
    wake: (hint = {}) => {
      if (stopped) return;
      if (hint.dispatchId) pendingDispatches.add(hint.dispatchId);
      if (hint.continuationKey) pendingContinuations.add(hint.continuationKey);
      scheduleSweep();
    },
    sweep: async () => {
      if (stopped) return;
      sweepRequested = true;
      await drainSweeps();
    },
    start: async () => {
      if (started || stopped) return;
      started = true;
      sweepRequested = true;
      await drainSweeps();
      const interval = deps.recoveryIntervalMs ?? 15_000;
      if (interval > 0) {
        recoveryTimer = setInterval(scheduleSweep, interval);
        recoveryTimer.unref();
      }
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (recoveryTimer) clearInterval(recoveryTimer);
      if (!sweepRunning) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 15_000);
        timer.unref();
      });
      await Promise.race([sweepRunning, timeout]);
      if (timer) clearTimeout(timer);
    },
  };
}
