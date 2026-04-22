import { log } from "evlog";
import { sleep } from "workflow";

import { countMetric } from "@/lib/metrics";
import { hibernateSession, readSession, writeSession } from "@/lib/sandbox/session";

/**
 * Lead time before the sandbox's deadline — we wake up this many ms before
 * expiry, giving us a window to snapshot without the SDK stopping the VM
 * first. 90s is enough for a fast snapshot + Redis write.
 */
const HIBERNATION_LEAD_MS = 90_000;
/**
 * Minimum sleep between decisions; protects against thundering-herd wakeups
 * when a chat turn keeps bumping the expiry just as we're about to fire.
 */
const MIN_SLEEP_MS = 30_000;
/** Longest single sleep we'll commit to — caps drift if Redis is wrong. */
const MAX_SLEEP_MS = 60 * 60 * 1000;

interface WakeDecision {
  action: "sleep" | "exit";
  /** ms since epoch when we should wake up next. Only set when action === "sleep". */
  wakeAt?: number;
  reason?: string;
}

async function decideWake(threadKey: string): Promise<WakeDecision> {
  "use step";
  const meta = await readSession(threadKey);
  if (!meta) return { action: "exit", reason: "session-gone" };
  if (meta.hibernated) return { action: "exit", reason: "already-hibernated" };

  const wakeAt = meta.expiresAt - HIBERNATION_LEAD_MS;
  const now = Date.now();
  if (wakeAt <= now) {
    return { action: "sleep", wakeAt: now + MIN_SLEEP_MS, reason: "imminent" };
  }
  return {
    action: "sleep",
    wakeAt: Math.min(wakeAt, now + MAX_SLEEP_MS),
    reason: "scheduled",
  };
}

async function performHibernation(
  threadKey: string,
): Promise<"hibernated" | "missing" | "still-active"> {
  "use step";
  // Re-read — the expiresAt might have been bumped while we slept.
  const meta = await readSession(threadKey);
  if (!meta) return "missing";
  if (meta.hibernated) return "missing";

  // Give the conversation one more buffer: if the deadline moved further out
  // than the hibernation lead, the user/chat is still engaged and we should
  // loop back to sleep instead of hibernating.
  if (meta.expiresAt - Date.now() > HIBERNATION_LEAD_MS * 2) {
    return "still-active";
  }

  const result = await hibernateSession(threadKey);
  if (result === "hibernated") {
    countMetric("sandbox.lifecycle.hibernated");
    return "hibernated";
  }
  countMetric("sandbox.lifecycle.hibernate_skipped", { reason: result });
  return "missing";
}

async function markLifecycleOwned(threadKey: string, runId: string): Promise<boolean> {
  "use step";
  const meta = await readSession(threadKey);
  if (!meta) return false;
  // Mark this workflow as the owner; the session-lifecycle run id lets a new
  // invocation take over if the previous one was lost.
  const claimed = { ...meta, lifecycleRunId: runId };
  await writeSession(threadKey, claimed);
  return true;
}

/**
 * Per-session workflow that watches the sandbox deadline and hibernates it
 * just before expiry. Started fire-and-forget from `getOrCreateSession` when
 * a fresh sandbox is provisioned. Exits on:
 *   - Session deleted (user ended the conversation)
 *   - Already hibernated (e.g. another caller raced us)
 *   - Successful hibernation
 */
export async function sandboxLifecycleWorkflow(threadKey: string, runId: string) {
  "use workflow";

  log.info("sandbox-lifecycle", `Started for thread ${threadKey} (run ${runId})`);
  const owned = await markLifecycleOwned(threadKey, runId);
  if (!owned) {
    log.info("sandbox-lifecycle", `No session; exiting (thread ${threadKey})`);
    return;
  }

  // Cap the loop at a sane iteration count so a malfunctioning Redis state
  // can't spin forever.
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const decision = await decideWake(threadKey);
    if (decision.action === "exit") {
      log.info(
        "sandbox-lifecycle",
        `Exiting thread=${threadKey} reason=${decision.reason ?? "unknown"}`,
      );
      return;
    }

    const wakeMs = Math.max(
      decision.wakeAt ?? Date.now() + MIN_SLEEP_MS,
      Date.now() + MIN_SLEEP_MS,
    );
    await sleep(new Date(wakeMs));

    const result = await performHibernation(threadKey);
    if (result === "hibernated" || result === "missing") {
      return;
    }
    // "still-active" — loop back and re-compute wake time against the new deadline.
  }

  log.warn("sandbox-lifecycle", `Max iterations hit for ${threadKey}; exiting`);
  countMetric("sandbox.lifecycle.max_iterations");
}
