import { Result } from "@repo/shared/result";
import { defineAgent, defineDynamic } from "eve";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { decideCapability, requirePrincipal } from "../../lib/policy/index.ts";
import { GITHUB_RUNTIME } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) return undefined;
      const decision = decideCapability(principal.value, GITHUB_RUNTIME.subagentDescriptor);
      if (Result.isError(decision) || !decision.value.discover) return undefined;
      return defineAgent({
        description:
          "Manage GitHub repositories, issues, pull requests, CI/CD workflows, deployments, code browsing, packages, projects, and organization settings.",
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
