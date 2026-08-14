/**
 * @fileoverview Follows a delegated turn's streams so it stops looking dead.
 *
 * A declared subagent runs in its own session and the parent suspends for the
 * whole span. From out here a delegated turn therefore says nothing for as
 * long as the work takes. Nobody could see what it did, and nothing refreshed
 * the turn lease, so the sweep reclaimed turns that worked perfectly well.
 *
 * The bot is the only place this can live: it holds sockets, and the agent cannot.
 *
 * Two things decide the shape. eve's stream is NDJSON, so `eve/client` owns the
 * wire format rather than a hand-rolled reader — which also brings the cursor and
 * reconnect handling. And eve puts a delegated child's progress on the *child's*
 * stream, the parent emitting only `subagent.called` and `subagent.completed`.
 * So this follower reads the parent for its boundaries, and each child the
 * parent names for its work.
 *
 * What lands in the projection belongs to the bot. The intent stays the agent's alone.
 */

import type { Delegation } from "@repo/shared/conversations";
import { messageOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { Client } from "eve/client";
import type { MessageStreamEvent } from "eve/client";

import type { ConversationFlowDeps } from "./types.ts";

const MAX_LINE = 200;

/**
 * How deep the follower descends the tree.
 *
 * A delegated subagent can itself delegate, so the work worth narrating can sit
 * below the first child. Stopping there showed only that something started.
 * Bounded rather than unbounded because each level opens a stream per node.
 * A line about a great-grandchild's tool call also sits further from what the
 * person asked than one line can usefully carry.
 */
const MAX_DEPTH = 3;

/**
 * One delegation's open streams: the parent, plus every child it adopts.
 *
 * The set matters. A child starts mid-stream and nothing ever awaits it.
 * Clearing the entry when the *parent* settles left children running with
 * nobody holding their controller. Those children were unabortable at shutdown
 * and invisible to the idempotency check. The next sweep then started a second
 * parent that replayed `subagent.called` and adopted the same child again.
 */
interface Following {
  readonly controller: AbortController;
  readonly streams: Set<Promise<void>>;
}

const running = new Map<string, Following>();

/**
 * The latest line each delivery shows.
 *
 * Held here rather than threaded through the render work, because a follower
 * outlives any one paint. Lost on restart, which is correct — the follower is lost
 * with it and starts again from the stream.
 */
const progress = new Map<string, string>();

/**
 * The newest narration line for a delivery, or undefined when the follower has
 * said nothing yet. The paint pass reads this on streaming frames only,
 * because a finished turn must not show a line about work that is over.
 */
export function subagentProgress(dispatchId: string): string | undefined {
  return progress.get(dispatchId);
}

/**
 * One entry of `actions.requested`, reached through the public event union.
 *
 * eve does not export the action type from `eve/client`. Derived rather than
 * restated, so a new action kind is a compile error here instead of a string this
 * file quietly cannot name.
 */
type ActionRequest = Extract<
  MessageStreamEvent,
  { type: "actions.requested" }
>["data"]["actions"][number];

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
 * The `default` is not a fallback for malformed input — the union is eve's.
 * It is the honest answer for the twenty-odd event types that say nothing a
 * person waiting on a delegation wants to read.
 */
function summarize(subagent: string, event: MessageStreamEvent): string | undefined {
  switch (event.type) {
    case "subagent.called": {
      return `${event.data.name} started`;
    }
    case "subagent.completed": {
      return `${event.data.subagentName} finished`;
    }
    // eve runs some subagents inline and forwards their events onto the parent's
    // stream wrapped in this one. Those children have no session to attach to.
    case "subagent.event": {
      return event.data.event.type === "actions.requested"
        ? describeActions(event.data.subagentName, event.data.event.data.actions)
        : undefined;
    }
    case "actions.requested": {
      return describeActions(subagent, event.data.actions);
    }
    // What the child actually said. Deltas are deliberately not read: they arrive
    // per-token and would refresh the lease hundreds of times a minute.
    case "message.completed": {
      return event.data.message === "" ? undefined : `${subagent}: ${event.data.message}`;
    }
    default: {
      return undefined;
    }
  }
}

/**
 * A credential for the next connection, or the empty string.
 *
 * Empty rather than a throw: the client treats it as "no auth", the route
 * answers 401, and `launch` reports that once. A stream that cannot
 * authenticate is the same outcome either way. This keeps the failure on the
 * reporting path rather than escaping an auth callback.
 */
async function freshToken(deps: ConversationFlowDeps): Promise<string> {
  const minted = await deps.eve.streamToken();
  return Result.isOk(minted) ? minted.value : "";
}

interface Follow {
  readonly deps: ConversationFlowDeps;
  readonly dispatchId: string;
  readonly continuationKey: string;
  readonly client: Client;
  readonly signal: AbortSignal;
  readonly onLine: () => Promise<void>;
  readonly following: Following;
}

interface Stream {
  /** The parent, or one of the children it names. */
  readonly sessionId: string;
  /** What to call the work in the line shown to the person. */
  readonly subagent: string;
  /**
   * Ignore anything emitted before this instant.
   *
   * Only meaningful for the parent, whose stream holds every earlier turn of the
   * conversation.
   */
  readonly since: number;
  /** How many levels below the turn this stream is. Children stop at MAX_DEPTH. */
  readonly depth: number;
}

/**
 * Read one session's stream until it ends or the delegation is withdrawn.
 *
 * Every line shown is also proof the turn is alive, so the same event that
 * updates the text also pushes the lease out. A refresh reporting `false` means this
 * delivery no longer owns the turn, and the follower stops rather than narrating
 * over whatever replaced it.
 */
async function readStream(follow: Follow, stream: Stream): Promise<void> {
  const { deps, dispatchId, continuationKey, signal, onLine } = follow;
  // A nonnegative cursor is what buys automatic reconnection — a tail-relative one
  // cannot resume, its absolute position being unknown. So the read starts from
  // the beginning and filters by `since` rather than seeking past.
  const session = follow.client.sessions.attach(stream.sessionId, { streamIndex: 0 });

  for await (const event of session.stream({ signal })) {
    if (signal.aborted) return;
    if (Date.parse(event.meta.at) < stream.since) continue;

    // Not awaited: this stream must keep draining, and every level feeds the
    // same line.
    if (event.type === "subagent.called" && stream.depth < MAX_DEPTH) {
      launch(follow, {
        sessionId: event.data.childSessionId,
        subagent: event.data.name,
        // eve creates the child session for this delegation, so its whole
        // stream belongs to it.
        since: 0,
        depth: stream.depth + 1,
      });
    }

    const summary = summarize(stream.subagent, event);
    if (summary === undefined) continue;

    if (!(await deps.store.delivery.refreshTurn(continuationKey, dispatchId))) return;
    progress.set(dispatchId, summary.slice(0, MAX_LINE));
    await onLine();
  }
}

/** Start a stream and keep it in the tree until it settles. */
function launch(follow: Follow, stream: Stream): void {
  const open = readStream(follow, stream).catch((cause: unknown) => {
    if (follow.signal.aborted) return;
    follow.deps.reporter.emit({
      op: "agent.render.follow-subagent",
      status: "error",
      errorTag: "FollowFailed",
      errorMessage: messageOf(cause),
      attributes: { dispatchId: follow.dispatchId, sessionId: stream.sessionId },
    });
  });
  follow.following.streams.add(open);
  void open.finally(() => follow.following.streams.delete(open));
}

/**
 * Start following, unless a follower already runs for this delivery.
 *
 * Idempotent because the render sweep revisits a dispatch on every pass, and a
 * second set of streams would double every line and every lease refresh.
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
  const following: Following = { controller: new AbortController(), streams: new Set() };
  running.set(dispatchId, following);

  launch(
    {
      deps,
      dispatchId,
      continuationKey,
      signal: following.controller.signal,
      onLine,
      following,
      // Fetched per connection, not stored. The credential is a Vercel OIDC
      // token, which the bot cannot mint itself and which carries a *fixed*
      // expiry shared across every mint — so a copy taken when the delegation
      // started can be dead long before the delegation is. This callback re-runs
      // on every reconnect, which is exactly where a renewal belongs.
      //
      // Declaring it as OIDC also sends the trusted-OIDC header deployment
      // protection reads. `redirect: "manual"` keeps it from following a
      // redirect to another origin.
      client: new Client({
        host: deps.eve.baseUrl,
        auth: { vercelOidc: { token: () => freshToken(deps) } },
        redirect: "manual",
      }),
    },
    {
      sessionId: delegation.sessionId,
      subagent: delegation.name,
      since: Date.parse(delegation.startedAt),
      depth: 0,
    },
  );

  // Cleared only once the whole tree is quiet. The loop re-checks because a
  // running stream can adopt a child mid-wait. The identity check keeps a
  // settling follower from evicting the one that replaced it.
  void (async () => {
    while (following.streams.size > 0) await Promise.allSettled(following.streams);
  })().finally(() => {
    if (running.get(dispatchId) === following) running.delete(dispatchId);
  });
}

/** Called when the turn ends, so a finished delivery leaves nothing streaming. */
export function stopFollowing(dispatchId: string): void {
  running.get(dispatchId)?.controller.abort();
  running.delete(dispatchId);
  progress.delete(dispatchId);
}

/** Shutdown: drops every open stream before the process goes. */
export function stopAllFollowers(): void {
  for (const following of running.values()) following.controller.abort();
  running.clear();
  progress.clear();
}
