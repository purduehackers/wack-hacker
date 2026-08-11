import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

import {
  CODE_SANDBOX_BRIDGE_PORT,
  CODE_SANDBOX_TIMEOUT_MS,
  CODE_SANDBOX_VCPUS,
} from "./lib/constants.ts";
import { CODE_SANDBOX_NETWORK_POLICY } from "./lib/network.ts";

/**
 * The single sandbox this subagent works in, Codex included.
 *
 * `harness.ts` hands the Codex adapter *this* sandbox rather than letting it
 * create its own, so there is one VM per session instead of two: one Eve knows
 * about and one it did not. Everything that made the second one expensive to
 * own — liveness probes, a reattach path, an unrecoverable-work error class —
 * is Eve's problem now, and Eve already solves it by resuming a stopped sandbox
 * on the next message with its filesystem intact.
 *
 * The backend is pinned rather than left to `defaultBackend()`. The adapter
 * reaches its in-sandbox bridge over a public port URL, which only the Vercel
 * backend can hand out; on Docker or just-bash the harness would have no way in.
 */
export default defineSandbox({
  backend: vercel({
    networkPolicy: CODE_SANDBOX_NETWORK_POLICY,
    // Declared here because ports are fixed at create time. The harness leases
    // this one per session through `bridgePorts`.
    ports: [CODE_SANDBOX_BRIDGE_PORT],
    resources: { vcpus: CODE_SANDBOX_VCPUS },
    timeout: CODE_SANDBOX_TIMEOUT_MS,
  }),
});
