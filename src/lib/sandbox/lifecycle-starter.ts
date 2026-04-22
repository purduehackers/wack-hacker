import { log } from "evlog";
import { start } from "workflow/api";

import { sandboxLifecycleWorkflow } from "../../workflows/sandbox-lifecycle.ts";

/**
 * Default `onProvisioned` hook for `getOrCreateSession` — fire-and-forget
 * start of the sandbox lifecycle workflow. This lives in its own module so
 * it can be excluded from coverage (it's pure glue over `workflow/api`);
 * tests pass their own no-op instead.
 */
export async function startSandboxLifecycle(threadKey: string): Promise<void> {
  try {
    const run = await start(sandboxLifecycleWorkflow, [threadKey, crypto.randomUUID()]);
    log.info("sandbox", `Lifecycle workflow started: ${run.runId} (${threadKey})`);
  } catch (err) {
    log.warn("sandbox", `Lifecycle workflow start failed (${threadKey}): ${String(err)}`);
  }
}
