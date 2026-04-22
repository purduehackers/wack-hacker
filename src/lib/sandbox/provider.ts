import type { SandboxProvider } from "./types.ts";

import { createCodingSandbox } from "./factory.ts";
import { VercelSandbox } from "./vercel-sandbox.ts";

/**
 * Build the production `SandboxProvider`. Delegates to `createCodingSandbox`
 * for new sandboxes and to `VercelSandbox.reconnect` for rejoining existing
 * ones. Tests build a provider backed by `InMemorySandbox` and pass it to
 * `getOrCreateSession` / `hibernateSession` — that keeps session-layer
 * logic testable without reaching for `vi.mock` on our own modules.
 */
export function defaultSandboxProvider(): SandboxProvider {
  return {
    create: (config) => createCodingSandbox(config),
    reconnect: (id, opts) => VercelSandbox.reconnect(id, opts),
  };
}
