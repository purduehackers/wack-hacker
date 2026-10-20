/**
 * Turning a stored render intent into Discord messages.
 *
 * One dispatch at a time, under a Redis claim: load the desired intent and its
 * immutable target, paint it, then record the applied revision. Every failure
 * path either leaves the claim for a retry or discards the dispatch, so a
 * dispatch never sits claimed forever.
 */

import { messageOf, tagOf, Transient, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { ParkedPayload } from "@repo/shared/wire";

import { renderHitl } from "../../agent/hitl/components.ts";
import { readTaskControl } from "../../agent/render/control-state.ts";
import { createRenderer, toRendererProjection } from "../../agent/render/renderer.ts";
import {
  needsWorkCard,
  publicFooter,
  renderWorkCard,
  workCardTitle,
} from "../../agent/render/work-card.ts";
import { continueTrace, traceOperation } from "../../framework/observability.ts";
import { stopFollowing, subagentProgress } from "./subagent-follower.ts";
import type { ConversationFlowDeps, RenderWork } from "./types.ts";

function emit(
  deps: ConversationFlowDeps,
  dispatchId: string,
  operation: string,
  error: unknown,
  status: "error" | "defect",
): void {
  deps.reporter.emit({
    op: operation,
    status,
    errorTag: tagOf(error),
    errorMessage: messageOf(error),
    attributes: { dispatchId },
  });
}

/** Something went wrong with this paint; the sweep will try it again. */
export function reportFailure(
  deps: ConversationFlowDeps,
  dispatchId: string,
  operation: string,
  error: unknown,
): void {
  emit(deps, dispatchId, operation, error, "error");
}

/**
 * Something is wrong with the *record*, so retrying cannot help.
 *
 * Captured as a defect rather than counted as an error: the intent, target or
 * projection was written by us and cannot be read back by us.
 */
async function discardDefect(
  deps: ConversationFlowDeps,
  dispatchId: string,
  operation: string,
  error: Error,
): Promise<undefined> {
  deps.reporter.captureDefect(error, { op: operation, attributes: { dispatchId } });
  emit(deps, dispatchId, operation, error, "defect");
  await deps.store.render.discard(dispatchId);
  return undefined;
}

async function loadWork(
  deps: ConversationFlowDeps,
  dispatchId: string,
): Promise<RenderWork | undefined> {
  const desired = await deps.store.renders.intent(dispatchId);
  if (Result.isError(desired)) {
    return discardDefect(deps, dispatchId, "agent.render.decode-intent", desired.error);
  }
  if (desired.value === undefined) {
    await deps.store.render.discard(dispatchId);
    return undefined;
  }

  const targetResult = await deps.store.renders.target(dispatchId);
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

  const loaded = await deps.store.renders.projection(dispatchId, target.anchorMessageId);
  if (Result.isError(loaded)) {
    return discardDefect(deps, dispatchId, "agent.render.decode-projection", loaded.error);
  }
  const control = await readTaskControl(deps.store.cancellations, deps.reporter, dispatchId);
  return {
    intent,
    target,
    projection: toRendererProjection(loaded.value),
    appliedRevision: loaded.value.appliedRevision,
    ...(control?.sessionId === intent.sessionId && control.eveTurnId === intent.eveTurnId
      ? { control }
      : {}),
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
  // Never on a terminal frame: the follower is stopped just below, and a finished
  // turn showing "code: reading files" is a line about work that is over.
  const progress = work.intent.phase === "streaming" ? subagentProgress(dispatchId) : undefined;
  // The revision alone cannot decide this. A delegated turn publishes no renders
  // for the whole span a subagent runs, so its narration changes what is on
  // screen without changing the intent — and a guard on the revision by itself
  // made every follower line a no-op, which is precisely the case the follower
  // exists for.
  const current = work.appliedRevision >= work.intent.revision;
  const narrated = (progress ?? "") === (work.projection.subagentActivity ?? "");
  if (current && narrated) return true;

  const card = await prepareCard(deps, work, progress);

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
  const painted = await renderer.write(renderFrame(work, progress, card));
  // A turn that has stopped streaming has nothing left to narrate.
  if (work.intent.phase !== "streaming") stopFollowing(dispatchId);

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

/** Promotion is projection metadata: it changes neither admission nor execution state. */
async function prepareCard(
  deps: ConversationFlowDeps,
  work: RenderWork,
  progress: string | undefined,
) {
  if (
    work.projection.workCard === undefined &&
    (needsWorkCard(work.intent, progress) ||
      work.control?.outcome !== undefined ||
      work.control?.request !== undefined)
  ) {
    const delivery = await deps.store.deliveries.read(work.target.continuationKey);
    work.projection.workCard = {
      title: workCardTitle(
        delivery?.dispatchId === work.intent.dispatchId ? delivery.deliveryRaw : undefined,
      ),
    };
  }
  if (work.projection.workCard === undefined) return undefined;
  const canCancel =
    work.intent.phase === "streaming" &&
    work.control !== undefined &&
    work.control.request === undefined &&
    work.control.outcome === undefined &&
    (await deps.eve.supportsCancel(work.intent).catch((cause: unknown) => {
      deps.reporter.captureDefect(cause, {
        op: "agent.work-card.cancel-capability",
        attributes: { dispatchId: work.intent.dispatchId },
      });
      return false;
    }));
  return renderWorkCard({
    intent: work.intent,
    target: work.target,
    title: work.projection.workCard.title,
    ...(work.control === undefined ? {} : { control: work.control }),
    canCancel,
    ...(progress === undefined ? {} : { progress }),
  });
}

export async function applyLatest(
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

          const completion = await deps.store.render.complete({
            dispatchId,
            claimToken,
            projection: work.projection,
            appliedRevision: Math.max(work.appliedRevision, work.intent.revision),
            terminal: work.intent.phase !== "streaming",
          });
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

export function reportPendingRender(deps: ConversationFlowDeps, payload: ParkedPayload): void {
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

function renderFrame(
  work: RenderWork,
  progress: string | undefined,
  card: ReturnType<typeof renderWorkCard> | undefined,
) {
  const footer = card === undefined ? publicFooter(work.intent.footer) : undefined;
  const hitl = work.intent.phase === "streaming" ? renderHitl(work.intent) : undefined;
  return {
    text: card?.text ?? (work.intent.text || (work.intent.phase === "streaming" ? "Working…" : "")),
    activity: "",
    ...(footer === undefined ? {} : { footer }),
    ...(card === undefined ? {} : { anchorComponents: card.components }),
    ...(work.intent.phase === "streaming" || card?.fullResult === undefined
      ? {}
      : { resultFile: card.fullResult, unclippedText: card.fullText }),
    ...(hitl?.notice === undefined ? {} : { notice: hitl.notice }),
    ...(hitl === undefined ? {} : { components: hitl.components }),
    ...(hitl === undefined ? {} : { mentionUserIds: hitl.mentionUserIds }),
    ...(hitl?.key === undefined ? {} : { hitlKey: hitl.key }),
    ...(progress === undefined ? {} : { subagentActivity: progress }),
    terminal: work.intent.phase !== "streaming",
  };
}
