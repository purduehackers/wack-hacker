/**
 * Installed-runtime probe only. Production calls public Session.cancel(); the
 * adapter and owner below prove what that method actually delivers and consumes.
 */
import { createSession } from "../../../node_modules/eve/dist/src/channel/session.js";
import type {
  Runtime,
  SessionCommandResult,
} from "../../../node_modules/eve/dist/src/channel/types.js";
import type {
  SessionInboxPayload,
  SessionInboxReader,
} from "../../../node_modules/eve/dist/src/execution/session-inbox/inbox.js";
import { ActiveTurn } from "../../../node_modules/eve/dist/src/execution/session/active-turn.js";
import { SessionInputQueue } from "../../../node_modules/eve/dist/src/execution/session/input-queue.js";
import { nextTurnDelivery } from "../../../node_modules/eve/dist/src/execution/session/next-input.js";
import { SessionStateCursor } from "../../../node_modules/eve/dist/src/execution/session/state-cursor.js";
import { initialSessionProjection } from "../../../node_modules/eve/dist/src/protocol/session-projection.js";

const payloads: SessionInboxPayload[] = [];
const observers = new Set<(payload: SessionInboxPayload) => void>();
const inbox: SessionInboxReader = {
  next: async () => payloads.shift(),
  drain: () => payloads.splice(0),
  takeLeading: (accepts) => {
    const results: SessionInboxPayload[] = [];
    while (payloads[0] !== undefined && accepts(payloads[0])) {
      const item = payloads.shift();
      if (item !== undefined) results.push(item);
    }
    return results.filter(accepts);
  },
  hasPending: () => payloads.length > 0,
  whenPending: async () => undefined,
  onInterrupt: (handler) => {
    observers.add(handler);
    return () => {
      observers.delete(handler);
    };
  },
  onDelivery: () => () => undefined,
  restore: (values) => {
    payloads.unshift(...values);
  },
};

const sent: unknown[] = [];
const unsupported = async (): Promise<never> => {
  throw new Error("Unexpected runtime operation");
};
const runtime: Runtime = {
  createSession: unsupported,
  dispatchContinuation: unsupported,
  resolveContinuation: unsupported,
  getEventStream: unsupported,
  getStreamTailIndex: unsupported,
  dispatchSession: async (input) => {
    if (input.command.kind !== "cancel") throw new Error("Only cancel is expected");
    sent.push(input);
    payloads.push(input.command);
    for (const observer of observers) observer(input.command);
    // The generic runtime interface selects its result from the command kind.
    // TypeScript cannot narrow that conditional generic after the check above.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- Runtime's conditional generic cannot narrow after the command.kind check
    return { status: "accepted", sessionId: input.sessionId } as SessionCommandResult<
      typeof input.command
    >;
  },
};

function cursor(turnId?: string) {
  const projection = initialSessionProjection();
  const state =
    turnId === undefined
      ? projection
      : {
          ...projection,
          started: true,
          activeTurnId: turnId,
          turns: { [turnId]: { turnId, sequence: 1, status: "active" as const } },
        };
  return new SessionStateCursor({
    serializedContext: {},
    history: [],
    inbox: { claimSessionHooks: async () => undefined },
    sessionWritable: new WritableStream(),
    sessionState: {
      version: 2,
      sessionId: "exact-session",
      continuationToken: "discord:example",
      hasProxyInputRequests: false,
      snapshot: {
        session: {
          sessionId: "exact-session",
          continuationToken: "discord:example",
          agent: { system: "" },
          state: { "eve.harness.sessionProjection": state },
        },
      },
    },
  });
}

export async function installedCancelProbe() {
  sent.length = 0;
  payloads.length = 0;
  const session = createSession("exact-session", runtime);
  const active = new ActiveTurn(
    {
      sessionId: session.id,
      inbox,
      cursor: cursor("newer-turn"),
      queue: new SessionInputQueue(),
    },
    { caller: undefined, principal: "requester" },
  );
  await session.cancel({ turnId: "older-turn" });
  const newerTurnAborted = active.signal.aborted;
  await session.cancel({ turnId: "newer-turn" });
  const matchedTurnAborted = active.signal.aborted;
  active.dispose();
  payloads.length = 0;
  await session.cancel({ turnId: "older-turn" });
  const idleOutcome = await nextTurnDelivery({
    inbox,
    cursor: cursor(),
    queue: new SessionInputQueue(),
    hasWorkingTasks: () => true,
  });
  return { sent: [...sent], newerTurnAborted, matchedTurnAborted, idleOutcome };
}
