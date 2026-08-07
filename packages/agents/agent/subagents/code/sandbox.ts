import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

import { CODE_SANDBOX_NETWORK_POLICY } from "../../lib/code-sandbox/network.ts";

const SANDBOX_TIMEOUT_MS = 30 * 60_000;

/** Eve owns provisioning, resumption, persistence, and teardown. */
export default defineSandbox({
  description:
    "A one-vCPU Eve/Vercel sandbox rooted at /workspace. It has no forwarded application environment and only public source/package egress.",
  backend: vercel({
    env: {},
    networkPolicy: CODE_SANDBOX_NETWORK_POLICY,
    resources: { vcpus: 1 },
    timeout: SANDBOX_TIMEOUT_MS,
  }),
  async onSession({ use }) {
    await use({
      networkPolicy: CODE_SANDBOX_NETWORK_POLICY,
      resources: { vcpus: 1 },
      timeout: SANDBOX_TIMEOUT_MS,
    });
  },
});
