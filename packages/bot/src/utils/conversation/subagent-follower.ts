/**
 * Follows the session's own stream so a delegated turn stops looking dead.
 *
 * A declared subagent runs in its own session. The parent's stream carries only
 * `subagent.called` and `subagent.completed`, and the parent is suspended for
 * everything between — so from out here a `code_task` is a turn that says
 * nothing for as long as the work takes. Two things went wrong because of that:
 * nobody could see what it was doing, and nothing refreshed the lease, so the
 * sweep reclaimed a turn that was working perfectly well.
 *
 * The bot is the only place this can live. It holds sockets; the agent cannot.
 *
 * What the follower writes is bot-owned on purpose. The intent stays the
 * agent's alone — the child's progress lands in the projection and the renderer
 * merges it, so nothing here invents content the agent is supposed to author.
 */

import type { Delegation } from "@repo/shared/conversations";
import { jsonText } from "@repo/shared/json";
import { z } from "zod";

import type { ConversationFlowDeps } from "./types.ts";

/**
 * Parent-stream events worth showing while a delegation runs.
 *
 * `subagent.called` and `subagent.completed` are the delegation's own
 * boundaries; the action events cover what the turn does around them. Anything
 * else is noise at this distance.
 */
const SHOWN = new Set([
  "subagent.called",
  "subagent.completed",
  "actions.requested",
  "action.result",
]);

const MAX_LINE = 200;

interface Follower {
  readonly stop: () => void;
}

const running = new Map<string, Follower>();

/**
 * The latest line each delivery is showing.
 *
 * Held here rather than threaded through the render work, because the follower
 * outlives any one paint: it is started from the sweep and reports for as long
 * as the delegation runs, while a paint is a moment. Lost on restart, which is
 * correct — the follower is lost with it and starts again from the stream.
 */
const progress = new Map<string, string>();

export function subagentProgress(dispatchId: string): string | undefined {
  return progress.get(dispatchId);
}

/**
 * A child agent's event, parsed at the boundary rather than inspected.
 *
 * Loose on purpose: this is another agent's payload and not our wire contract,
 * so an unrecognised shape must render nothing rather than throw. Only the two
 * fields worth showing are named.
 */
const streamEventSchema = z.looseObject({
  type: z.string(),
  data: z
    .looseObject({
      name: z.string().optional(),
      output: z.string().optional(),
      actions: z
        .array(
          z.looseObject({ toolName: z.string().optional(), subagentName: z.string().optional() }),
        )
        .optional(),
    })
    .optional(),
});

type StreamEvent = z.output<typeof streamEventSchema>;

function summarize(subagent: string, event: StreamEvent): string | undefined {
  if (!SHOWN.has(event.type)) return undefined;
  if (event.type === "subagent.called") return `${event.data?.name ?? subagent} started`;
  if (event.type === "subagent.completed") return `${event.data?.name ?? subagent} finished`;
  const named = (event.data?.actions ?? [])
    .map((action) => action.subagentName ?? action.toolName)
    .filter((entry): entry is string => entry !== undefined);
  return named.length === 0 ? undefined : `${subagent}: ${named.join(", ")}`;
}

/**
 * Read the child's stream until it ends or the delegation is withdrawn.
 *
 * Every line seen is also proof the turn is alive, so the lease is pushed out on
 * the same event that updates the text. A refresh that reports `false` means
 * this delivery no longer owns the turn, and the follower stops rather than
 * narrating over whatever replaced it.
 */
interface FollowInput {
  readonly deps: ConversationFlowDeps;
  readonly dispatchId: string;
  readonly continuationKey: string;
  readonly delegation: Delegation;
  readonly signal: AbortSignal;
  readonly onLine: () => Promise<void>;
}

async function follow({
  deps,
  dispatchId,
  continuationKey,
  delegation,
  signal,
  onLine,
}: FollowInput): Promise<void> {
  const url = new URL(`/eve/v1/session/${delegation.sessionId}/stream`, deps.eve.baseUrl);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${delegation.streamToken}` },
    signal,
  });
  if (!response.ok || response.body === null) {
    throw new Error(`child stream returned ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const complete = buffered.split("\n");
      buffered = complete.pop() ?? "";
      for (const line of complete) {
        if (!line.startsWith("data:")) continue;
        const parsed = streamEventSchema.safeParse(jsonText.safeParse(line.slice(5)).data);
        if (!parsed.success) continue;
        const summary = summarize(delegation.name, parsed.data);
        if (summary === undefined) continue;

        const held = await deps.store.queue.refreshLease(continuationKey, dispatchId);
        if (!held) return;
        progress.set(dispatchId, summary.slice(0, MAX_LINE));
        await onLine();
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Start following, unless this delivery is already being followed.
 *
 * Idempotent because the render sweep revisits a dispatch on every pass, and a
 * second stream would double every line and double every lease refresh.
 */
export function followSubagent(
  deps: ConversationFlowDeps,
  dispatchId: string,
  continuationKey: string,
  delegation: Delegation,
  onLine: () => Promise<void>,
): void {
  if (running.has(dispatchId)) return;
  const controller = new AbortController();
  running.set(dispatchId, { stop: () => controller.abort() });

  void follow({ deps, dispatchId, continuationKey, delegation, signal: controller.signal, onLine })
    .catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      deps.reporter.emit({
        op: "agent.render.follow-subagent",
        status: "error",
        errorTag: "FollowFailed",
        errorMessage: cause instanceof Error ? cause.message : String(cause),
        attributes: { dispatchId, sessionId: delegation.sessionId },
      });
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

/** Shutdown: every open child stream is dropped before the process goes. */
export function stopAllFollowers(): void {
  for (const follower of running.values()) follower.stop();
  running.clear();
  progress.clear();
}
