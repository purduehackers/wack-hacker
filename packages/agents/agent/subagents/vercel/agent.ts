import { Result } from "@repo/shared/result";
import { defineAgent, defineDynamic } from "eve";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { decideCapability, requirePrincipal } from "../../lib/policy/index.ts";
import { VERCEL_RUNTIME } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) return undefined;
      const decision = decideCapability(principal.value, VERCEL_RUNTIME.subagentDescriptor);
      if (Result.isError(decision) || !decision.value.discover) return undefined;
      return defineAgent({
        description:
          "Operate Vercel projects, deployments, domains, observability, integrations, edge-platform features, security, rolling releases, and sandboxes.",
        model: "anthropic/claude-sonnet-5",
        outputSchema: SUBAGENT_OUTPUT_SCHEMA,
      });
    },
  },
});
