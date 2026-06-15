import { REST } from "@discordjs/rest";

import { env } from "../../../../env.ts";

const realRest = new REST().setToken(env.DISCORD_BOT_TOKEN);
let active: REST = realRest;

/**
 * Dev/simulator-only: swap the Discord REST transport that every Discord tool
 * and the approval runtime call through. No-ops in production. Pass `null` to
 * restore the real client. The exported `discord` is a Proxy over the active
 * client, so the tool modules that `import { discord }` need no changes.
 */
export function __setDiscordRestForSimulation(rest: REST | null): void {
  if (process.env.NODE_ENV === "production") return;
  active = rest ?? realRest;
}

const restProxyHandler: ProxyHandler<REST> = {
  get(_target, prop) {
    const value = (active as unknown as Record<PropertyKey, unknown>)[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(active)
      : value;
  },
};

export const discord: REST = new Proxy(active, restProxyHandler);
