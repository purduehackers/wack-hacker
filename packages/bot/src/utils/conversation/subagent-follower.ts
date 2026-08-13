/**
 * Follows a delegated turn's streams so it stops looking dead.
 *
 * A declared subagent runs in its own session, and the parent suspends for the
 * whole span. From out here a `code_task` is a turn that says nothing for as long
 * as the work takes. Two things went wrong because of that: nobody could see what
 * it was doing, and nothing refreshed the turn lease, so the sweep reclaimed a
 * turn that was working perfectly well.
 *
 * The bot is the only place this can live. It holds sockets; the agent cannot.
 *
 * What the follower writes is bot-owned on purpose. The intent stays the agent's
 * alone — the child's progress lands in the projection and the renderer merges
 * it, so nothing here invents content the agent is supposed to author.
 *
 * ---
 *
 * Two things were wrong here, and both looked like nothing.
 *
 * **The stream was parsed as SSE.** Every line was filtered for a `data:` prefix,
 * but eve's stream is NDJSON, so every line was discarded. The follower emitted no
 * progress and refreshed no lease — the two things it exists to do — while looking
 * perfectly healthy. Three conclusions were drawn from that silence and all three
 * were wrong: the stream was assumed empty, the session idle, and replay
 * unsupported. `eve/client` owns the wire format now, and brings the cursor and
 * reconnect handling this had no version of at all.
 *
 * **It followed the wrong session.** eve is explicit that "a delegated subagent
 * publishes progress on its own child-session stream. The parent only emits
 * `subagent.called` with a `childSessionId`, which a client uses to attach."
 * Following the parent therefore yielded two events for an entire delegation —
 * enough to narrate a start and a finish, and nowhere near enough to keep a
 * 30-minute lease alive across work that takes longer than that. So the parent is
 * followed for its boundaries, and each child it names is followed for its work.
 */

import type { Delegation } from "@repo/shared/conversations";
import { Client } from "eve/client";
import type { MessageStreamEvent } from "eve/client";

import type { ConversationFlowDeps } from "./types.ts";

const MAX_LINE = 200;

interface Follower {
  readonly stop: () => void;
}

const running = new Map<string, Follower>();

/**
 * The latest line each delivery is showing.
 *
 * Held here rather than threaded through the render work, because the follower
 * outlives any one paint: it is started from the sweep and reports for as long as
 * the delegation runs, while a paint is a moment. Lost on restart, which is
 * correct — the follower is lost with it and starts again from the stream.
 */
const progress = new Map<string, string>();

export function subagentProgress(dispatchId: string): string | undefined {
  return progress.get(dispatchId);
}

/**
 * One entry of `actions.requested`, reached through the public event union.
 *
 * eve does not export the action type from `eve/client`, and the path it does
 * live on is internal to the package. Derived rather than restated, so a new
 * action kind is a compile error here instead of a string this file quietly
 * cannot name.
 */
type ActionRequest = Extract<
  MessageStreamEvent,
  { type: "actions.requested" }
>["data"]["actions"][number];

/** What a requested action is called, whichever kind it is. */
function actionName(action: ActionRequest): string {
  if (action.kind === "tool-call") return action.toolName;
  if (action.kind === "load-skill") return "loading a skill";
  return action.kind === "subagent-call" ? action.subagentName : action.remoteAgentName;
}

function describeActions(subagent: string, actions: readonly ActionRequest[]): string | undefined {
  return actions.length === 0 ? undefined : `${subagent}: ${actions.map(actionName).join(", ")}`;
}

/**
 * One line of narration, or nothing when the event is not worth showing.
 *
 * Narrower than it looks: the union is eve's, so the `default` here is not a
 * fallback for malformed input but the honest answer for the twenty-odd event
 * types that say nothing a person waiting on a delegation wants to read.
 *
 * `subagent.event` covers the other kind of child. eve runs some subagents inline
 * and forwards their events onto their parent's stream wrapped in this one; those
 * children have no session to attach to, so this is the only place their work
 * shows up. Handling both kinds costs one branch.
 */
function summarize(subagent: string, event: MessageStreamEvent): string | undefined {
  switch (event.type) {
    case "subagent.called": {
      return `${event.data.name} started`;
    }
    case "subagent.completed": {
      return `${event.data.subagentName} finished`;
    }
    case "subagent.event": {
      return event.data.event.type === "actions.requested"
        ? describeActions(event.data.subagentName, event.data.event.data.actions)
        : undefined;
    }
    case "actions.requested": {
      return describeActions(subagent, event.data.actions);
    }
    case "message.completed": {
      // What the child actually said, which for a `code_task` is the only place
      // its reasoning surfaces at all. Deltas are deliberately not read: they
      // arrive per-token and would refresh the lease hundreds of times a minute.
      return event.data.message === "" ? undefined : `${subagent}: ${event.data.message}`;
    }
    default: {
      return undefined;
    }
  }
}

interface FollowInput {
  readonly deps: ConversationFlowDeps;
  readonly dispatchId: string;
  readonly continuationKey: string;
  readonly delegation: Delegation;
  readonly signal: AbortSignal;
  readonly onLine: () => Promise<void>;
}

/**
 * A client bound to one delegation's credential.
 *
 * The stream token is a Vercel OIDC token, minted where the delegation was
 * announced because the bot has no Vercel identity of its own. Declaring it as
 * OIDC rather than a bare bearer also sends the trusted-OIDC header, which is what
 * deployment protection reads. The callback re-runs on every reconnect, so this is
 * where a refresh would go if these ever needed one — they do not, since a token
 * outlives any delegation by design.
 */
function clientFor(input: FollowInput): Client {
  return new Client({
    host: input.deps.eve.baseUrl,
    auth: { vercelOidc: { token: () => Promise.resolve(input.delegation.streamToken) } },
    // A credential-bearing client must never follow a redirect to another origin
    // carrying its authorization header.
    redirect: "manual",
  });
}

interface StreamInput {
  /** Which session to read. The parent, or one of the children it names. */
  readonly sessionId: string;
  /** What to call the work in the line shown to the person. */
  readonly subagent: string;
  /**
   * Ignore anything emitted before this instant.
   *
   * Only meaningful for the parent, whose stream holds every earlier turn of the
   * conversation: replaying those would narrate work that finished long ago. A
   * child session is created for this delegation, so its whole stream is relevant
   * and it passes `0`.
   */
  readonly since: number;
  /** Whether a `subagent.called` here should open another stream. */
  readonly adoptChildren: boolean;
}

/**
 * Read one session's stream until it ends or the delegation is withdrawn.
 *
 * Every line shown is also proof the turn is alive, so the lease is pushed out on
 * the same event that updates the text. A refresh reporting `false` means this
 * delivery no longer owns the turn, and the follower stops rather than narrating
 * over whatever replaced it.
 */
async function readStream(input: FollowInput, stream: StreamInput): Promise<void> {
  const { deps, dispatchId, continuationKey, signal, onLine } = input;
  // A nonnegative cursor is what buys automatic reconnection — a tail-relative
  // one cannot resume, because its absolute position is unknown — so the stream
  // is read from the beginning and filtered by `since` rather than sought past.
  const session = clientFor(input).sessions.attach(stream.sessionId, { streamIndex: 0 });

  for await (const event of session.stream({ signal })) {
    if (signal.aborted) return;
    if (Date.parse(event.meta.at) < stream.since) continue;

    if (stream.adoptChildren && event.type === "subagent.called") {
      adopt(input, event.data.childSessionId, event.data.name);
    }

    const summary = summarize(stream.subagent, event);
    if (summary === undefined) continue;

    const held = await deps.store.delivery.refreshTurn(continuationKey, dispatchId);
    if (!held) return;
    progress.set(dispatchId, summary.slice(0, MAX_LINE));
    await onLine();
  }
}

/**
 * Start reading a child the parent just named.
 *
 * Not awaited: the parent's stream must keep draining, and both feed the same
 * progress line. A child does not adopt its own children — a grandchild's tool
 * calls are further from what the person asked than this one line can usefully
 * say, and following every level would open a stream per node of the tree.
 */
function adopt(input: FollowInput, childSessionId: string, name: string): void {
  void readStream(input, {
    sessionId: childSessionId,
    subagent: name,
    since: 0,
    adoptChildren: false,
  }).catch((cause: unknown) => {
    if (input.signal.aborted) return;
    report(input, cause, childSessionId);
  });
}

function report(input: FollowInput, cause: unknown, sessionId: string): void {
  input.deps.reporter.emit({
    op: "agent.render.follow-subagent",
    status: "error",
    errorTag: "FollowFailed",
    errorMessage: cause instanceof Error ? cause.message : String(cause),
    attributes: { dispatchId: input.dispatchId, sessionId },
  });
}

/**
 * Start following, unless this delivery is already being followed.
 *
 * Idempotent because the render sweep revisits a dispatch on every pass, and a
 * second set of streams would double every line and double every lease refresh.
 */
export function followSubagent(
  deps: ConversationFlowDeps,
  dispatchId: string,
  continuationKey: string,
  delegation: Delegation,
  onLine: () => Promise<void>,
): void {
  if (running.has(dispatchId)) return;
  // One controller for the whole tree, so stopping the delivery stops the parent
  // stream and every child it adopted in one call.
  const controller = new AbortController();
  running.set(dispatchId, { stop: () => controller.abort() });

  const input: FollowInput = {
    deps,
    dispatchId,
    continuationKey,
    delegation,
    signal: controller.signal,
    onLine,
  };
  void readStream(input, {
    sessionId: delegation.sessionId,
    subagent: delegation.name,
    since: Date.parse(delegation.startedAt),
    adoptChildren: true,
  })
    .catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      report(input, cause, delegation.sessionId);
    })
    .finally(() => {
      running.delete(dispatchId);
    });
}

/** Called when the turn ends, so a finished delivery leaves nothing streaming. */
export function stopFollowing(dispatchId: string): void {
  running.get(dispatchId)?.stop();
  running.delete(dispatchId);
  progress.delete(dispatchId);
}

/** Shutdown: every open stream is dropped before the process goes. */
export function stopAllFollowers(): void {
  for (const follower of running.values()) follower.stop();
  running.clear();
  progress.clear();
}
