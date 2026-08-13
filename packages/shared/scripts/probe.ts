/**
 * Shared scaffolding for the writer checks.
 *
 * `check:delivery` and `check:render` drive different transitions but need the
 * same three things: a synthetic conversation that is safe to point at any
 * environment, a way to erase it either side of a run, and an assertion that
 * prints rather than throws so one failure does not hide the rest.
 */

import {
  activeKey,
  AGENT_READY_SET_KEY,
  AGENT_RENDER_READY_SET_KEY,
  parkedKey,
  pendingKey,
  QUEUE_INDEX_KEY,
  queueMember,
  renderClaimKey,
  renderIntentKey,
  renderMember,
  renderOutcomeKey,
  renderProjectionKey,
  renderTargetKey,
  resetKey,
  resetPendingKey,
  seenKey,
} from "../src/conversations/keys.ts";
import type { RedisClient } from "../src/redis/client.ts";
import type { MessagePayload } from "../src/wire.ts";

/** Outside the range Discord mints, so a probe can never collide with real traffic. */
interface ProbeIds {
  readonly continuationKey: string;
  readonly messageId: string;
  readonly userId: string;
}

export function probeMessage(ids: ProbeIds, content: string): MessagePayload {
  return {
    kind: "mention",
    continuationKey: ids.continuationKey,
    content,
    messageId: ids.messageId,
    principal: { userId: ids.userId, username: "probe", nickname: "probe", memberRoles: [] },
    channel: { id: ids.continuationKey, name: "probe" },
  };
}

/**
 * Erase everything a probe can touch.
 *
 * Through the key catalog, not by re-spelling it: a probe that scrubs a key the
 * code no longer writes leaves the real one behind, and the next run inherits it.
 * Render keys are per-dispatch and `enqueue` mints those ids itself, so the caller
 * collects them as it goes and hands them back here.
 */
export async function scrubProbe(
  redis: RedisClient,
  continuationKey: string,
  minted: ReadonlySet<string>,
): Promise<void> {
  await redis.del(
    activeKey(continuationKey),
    parkedKey(continuationKey),
    pendingKey(continuationKey),
    seenKey(continuationKey),
    resetKey(continuationKey),
    resetPendingKey(continuationKey),
  );
  for (const dispatchId of minted) {
    await redis.del(
      renderTargetKey(dispatchId),
      renderIntentKey(dispatchId),
      renderProjectionKey(dispatchId),
      renderClaimKey(dispatchId),
      renderOutcomeKey(dispatchId),
    );
    await redis.srem(AGENT_RENDER_READY_SET_KEY, renderMember(dispatchId));
  }
  await redis.srem(QUEUE_INDEX_KEY, queueMember(continuationKey));
  await redis.srem(AGENT_READY_SET_KEY, queueMember(continuationKey));
}

/** Prints the verdict and exits non-zero if anything failed. */
export function finish(failures: number, success: string): never {
  if (failures === 0) {
    console.info(`\n${success}`);
    process.exit(0);
  }
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}

interface Probe {
  /** Compared structurally, so an object or array reads as well as a scalar. */
  check: (label: string, actual: unknown, expected: unknown) => void;
  report: (success: string) => never;
}

export function createProbe(): Probe {
  let failures = 0;
  return {
    check(label, actual, expected) {
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      if (!ok) failures += 1;
      console.info(`   ${ok ? "ok  " : "FAIL"} ${label.padEnd(48)} ${JSON.stringify(actual)}`);
      if (!ok) console.error(`        expected ${JSON.stringify(expected)}`);
    },
    report: (success) => finish(failures, success),
  };
}

/** Whether an operation refused, for the cases where refusing is the contract. */
export async function throws(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}
