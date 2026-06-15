import type { REST } from "@discordjs/rest";

import type { SimEventBus } from "./event-bus.ts";
import type { VirtualGuild } from "./virtual-guild.ts";

import { createRouteDispatcher } from "./route-dispatch.ts";

interface FakeRestOptions {
  /** Real REST to forward non-approval Discord tool calls to (LIVE only). */
  realRest?: REST;
  /** Enable passthrough of Discord domain-tool writes to the real server. */
  passthrough?: boolean;
}

interface RestRequestOptions {
  body?: unknown;
}

/**
 * A fake `@discordjs/rest` `REST` (transport B) that the swapped
 * `tools/discord/client.ts` singleton points at during a simulator run. Routes
 * every verb through {@link createRouteDispatcher}: approval prompts/decisions
 * and (by default) all Discord tool writes are virtualized onto the
 * {@link VirtualGuild}; with `realDiscordTools` they pass through to a real REST.
 */
export function createFakeRest(
  guild: VirtualGuild,
  bus: SimEventBus,
  options: FakeRestOptions = {},
): REST {
  const dispatcher = createRouteDispatcher(guild, bus, options);
  const verb = (method: string) => (route: string, requestOptions?: RestRequestOptions) =>
    dispatcher.handle(method, route, requestOptions);

  return {
    get: verb("GET"),
    post: verb("POST"),
    patch: verb("PATCH"),
    put: verb("PUT"),
    delete: verb("DELETE"),
  } as unknown as REST;
}
