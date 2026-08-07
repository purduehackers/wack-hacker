/** Gateway turns in; Redis-owned, per-conversation deliveries out. */

import type { ConversationStore } from "@repo/shared/conversations";
import { RecoveryRequired, Transient, tagOf } from "@repo/shared/errors";
import type { KnownError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Reporter } from "@repo/shared/result/observe";
import type { MessagePayload, ParkedPayload, ResetPayload } from "@repo/shared/wire";

import type { AgentClient, AgentError } from "./client.ts";

export interface AgentRouterDeps {
  readonly client: AgentClient;
  readonly queue: ConversationStore["queue"];
  readonly reporter: Reporter;
  /** Terminal Discord paint is the visible commit barrier for this delivery. */
  readonly beforeComplete?: (payload: ParkedPayload) => Promise<boolean>;
  /** Set to zero in focused tests. */
  readonly recoveryIntervalMs?: number;
}

async function kick(
  deps: AgentRouterDeps,
  continuationKey: string,
): Promise<AgentError | undefined> {
  const next = await deps.queue.claim(continuationKey);
  if (Result.isError(next)) {
    // Enqueue validates before storage, so malformed Redis data is an invariant
    // defect. Keep its fenced claim for inspection rather than advancing past it.
    deps.reporter.captureDefect(next.error, {
      op: "agent.router.claim",
      attributes: { continuationKey },
    });
    return;
  }

  const claimed = next.value;
  if (claimed === undefined) return;

  const sent = await deps.client.sendMessage(claimed.payload);
  if (Result.isOk(sent)) {
    // A very fast park signal may already have consumed this claim. The token
    // CAS makes the late acknowledgement a harmless no-op in that case.
    await deps.queue.confirm(continuationKey, claimed.claimToken, sent.value.sessionId);
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
  // If ingress never admitted the POST, the claimed lease makes it retryable.
  // Once ingress changes it to live, only an exact park or explicit reset may
  // advance it; an expired ambiguous admission becomes recovery-required.
  return sent.error;
}

function reportPendingRender(deps: AgentRouterDeps, payload: ParkedPayload): void {
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

async function resetConversation(
  deps: AgentRouterDeps,
  payload: ResetPayload,
): Promise<Result<void, KnownError>> {
  const prepared = await Result.tryPromise({
    try: () => deps.queue.beginReset(payload.continuationKey),
    catch: (cause) =>
      new Transient({
        operation: "agent.router.begin-reset",
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  });
  if (Result.isError(prepared)) return prepared;

  const resetId = prepared.value;
  const reset = await deps.client.sendReset({ ...payload, resetId });
  // An ambiguous remote result keeps the barrier installed. A later reset
  // reuses the same id and safely finishes or retries the cutover.
  if (Result.isError(reset)) return reset;

  const committed = await Result.tryPromise({
    try: () => deps.queue.commitReset(payload.continuationKey, resetId),
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

async function recoverActiveQueues(deps: AgentRouterDeps): Promise<void> {
  for (const continuationKey of await deps.queue.keys()) {
    const recovery = await deps.queue.recoverAdmission(continuationKey);
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
    await kick(deps, continuationKey);
  }
}

export function createAgentRouter(deps: AgentRouterDeps) {
  let stopped = false;
  let sweepRunning = false;

  const onParked = async (payload: ParkedPayload): Promise<void> => {
    if (stopped) return;
    if (deps.beforeComplete !== undefined && !(await deps.beforeComplete(payload))) {
      reportPendingRender(deps, payload);
      return;
    }
    if (stopped) return;
    const status = await deps.queue.complete(payload);
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
    if (status === "completed") await kick(deps, payload.continuationKey);
  };

  const sweep = async (): Promise<void> => {
    if (stopped || sweepRunning) return;
    sweepRunning = true;
    try {
      // Park markers are the durable truth; HTTP callbacks are only wakeups.
      for (const continuationKey of await deps.queue.readyKeys()) {
        const parked = await deps.queue.parked(continuationKey);
        if (Result.isError(parked)) {
          deps.reporter.captureDefect(parked.error, {
            op: "agent.router.recover-marker",
            attributes: { continuationKey },
          });
          continue;
        }
        if (parked.value !== undefined) await onParked(parked.value);
      }

      // Also recover a process dying after atomic enqueue or while crossing
      // the bot→Eve admission boundary.
      await recoverActiveQueues(deps);
    } finally {
      sweepRunning = false;
    }
  };

  const recoveryIntervalMs = deps.recoveryIntervalMs ?? 60_000;
  const timer =
    recoveryIntervalMs <= 0
      ? undefined
      : setInterval(() => {
          void sweep().catch((cause: unknown) => {
            deps.reporter.captureDefect(cause, { op: "agent.router.recovery" });
          });
        }, recoveryIntervalMs);
  timer?.unref();

  return {
    /** Persist first, then atomically claim if this continuation is idle. */
    submit: async (payload: MessagePayload) => {
      const submitted = await Result.tryPromise({
        try: async () => {
          await deps.queue.enqueue(payload);
          return stopped ? undefined : kick(deps, payload.continuationKey);
        },
        catch: (cause) =>
          new Transient({
            operation: "agent.router.submit",
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      if (Result.isError(submitted)) return submitted;
      return submitted.value === undefined ? Result.ok(undefined) : Result.err(submitted.value);
    },

    onParked,
    sweep,

    /**
     * Install a durable cutover before touching Eve. Admissions linearized before
     * it are retired; messages enqueued after it wait in the next generation.
     */
    reset: async (payload: ResetPayload): Promise<Result<void, KnownError>> => {
      const reset = await resetConversation(deps, payload);
      if (Result.isOk(reset) && !stopped) await kick(deps, payload.continuationKey);
      return reset;
    },

    stop: (): void => {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
    },
  };
}

export type AgentRouter = ReturnType<typeof createAgentRouter>;
