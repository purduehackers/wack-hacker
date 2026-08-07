import { Result } from "@repo/shared/result";
import { defineAgent, defineDynamic } from "eve";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { decideCapability, requirePrincipal } from "../../lib/policy/index.ts";
import { DISCORD_SUBAGENT_DESCRIPTOR } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) {
        // oxlint-disable-next-line unicorn/no-null -- Eve dynamic resolvers use null to hide a capability.
        return null;
      }
      const decision = decideCapability(principal.value, DISCORD_SUBAGENT_DESCRIPTOR);
      if (Result.isError(decision) || !decision.value.discover) {
        // oxlint-disable-next-line unicorn/no-null -- Eve dynamic resolvers use null to hide a capability.
        return null;
      }
      return defineAgent({
        description:
          "Manage the Discord server — channels, roles, members, messages, webhooks, scheduled events, " +
          "threads, emojis, stickers, invites, moderation, audit logs, and server settings.",
        model: "anthropic/claude-sonnet-5",
        outputSchema: SUBAGENT_OUTPUT_SCHEMA,
      });
    },
  },
});
