import { Result } from "@repo/shared/result";
import { defineAgent, defineDynamic } from "eve";
import type { SessionAuthContext } from "eve/context";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { decideCapability, requirePrincipal } from "../../lib/policy/index.ts";
import { DISCORD_RUNTIME } from "./lib/runtime.ts";

/**
 * Discovery is a function of role policy: an unauthenticated delivery and a
 * principal whose policy withholds discovery are both simply "not discoverable",
 * which keeps the resolver to a single hidden-capability exit.
 */
function discoverable(current: SessionAuthContext | null | undefined): boolean {
  const principal = requirePrincipal(current);
  if (Result.isError(principal)) return false;
  const decision = decideCapability(principal.value, DISCORD_RUNTIME.subagentDescriptor);
  return !Result.isError(decision) && decision.value.discover;
}

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!discoverable(ctx.session.auth.current)) return undefined;
      return defineAgent({
        description:
          "Manage the Discord server — channels, roles, members, messages, webhooks, scheduled events, " +
          "threads, emojis, stickers, invites, moderation, audit logs, and server settings.",
        model: "deepseek/deepseek-v4-flash-0731",
        modelOptions: {
          providerOptions: {
            // DeepSeek caches implicitly, so this only matters if the gateway
            // ever falls back to a provider needing explicit cache markers.
            gateway: { caching: "auto" },
          },
        },
        outputSchema: SUBAGENT_OUTPUT_SCHEMA,
      });
    },
  },
});
