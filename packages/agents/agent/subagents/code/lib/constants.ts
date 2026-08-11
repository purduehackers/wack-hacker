/**
 * Shape of the one sandbox this subagent owns.
 *
 * These live apart from `sandbox.ts` because two readers need them: Eve's
 * sandbox slot, which creates the sandbox, and `harness.ts`, which hands Codex
 * a bridge port that has to be one Eve actually exposed.
 */

/** Port the Codex adapter binds its in-sandbox bridge to. Must be exposed. */
export const CODE_SANDBOX_BRIDGE_PORT = 4_000;

export const CODE_SANDBOX_VCPUS = 2;

/**
 * Vercel stops the VM after this much inactivity. It is not a deadline on the
 * work: Eve preserves the filesystem and resumes the sandbox on the next
 * message, so a session picked up the next day still finds its checkout.
 */
export const CODE_SANDBOX_TIMEOUT_MS = 45 * 60_000;

/** How long one `code_task` turn may run before its abort signal fires. */
export const CODE_TASK_TIMEOUT_MS = 20 * 60_000;

/** The Codex bridge has to install and start before the first prompt lands. */
export const CODE_BRIDGE_STARTUP_TIMEOUT_MS = 5 * 60_000;
