import { Result } from "@repo/shared/result";
import { defineAgent, defineDynamic } from "eve";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { decideCapability, requirePrincipal } from "../../lib/policy/index.ts";
import { GITHUB_SUBAGENT_DESCRIPTOR } from "./lib/descriptors.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const principal = requirePrincipal(ctx.session.auth.current);
      // oxlint-disable-next-line unicorn/no-null -- null hides a dynamic subagent
      if (Result.isError(principal)) return null;
      const decision = decideCapability(principal.value, GITHUB_SUBAGENT_DESCRIPTOR);
      // oxlint-disable-next-line unicorn/no-null -- null hides a dynamic subagent
      if (Result.isError(decision) || !decision.value.discover) return null;
      return defineAgent({
        description:
          "Manage GitHub repositories, issues, pull requests, CI/CD workflows, deployments, code browsing, packages, projects, and organization settings.",
        model: "anthropic/claude-sonnet-5",
        outputSchema: SUBAGENT_OUTPUT_SCHEMA,
      });
    },
  },
});
