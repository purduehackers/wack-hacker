/**
 * The framework's HTTP API, authored only to let a test invocation be somebody.
 *
 * Route auth keeps the framework default. What this adds is `onMessage`. That
 * hook is the one place to choose a session's authenticated assertion for a
 * caller arriving over HTTP rather than through Discord. Without one of those,
 * `eve invoke` creates a session with no principal, and every admin-gated path
 * refuses before the thing under test ever runs.
 *
 * See `lib/discord/impersonate.ts` for why that cannot happen in production.
 */

import { localDev, vercelOidc } from "eve/channels/auth";
import { defaultEveAuth, eveChannel } from "eve/channels/eve";

import { impersonatedAuth } from "../lib/discord/impersonate.ts";

export default eveChannel({
  auth: [vercelOidc(), localDev()],
  async onMessage(ctx) {
    const impersonated = await impersonatedAuth();
    return { auth: impersonated ?? defaultEveAuth(ctx) };
  },
});
