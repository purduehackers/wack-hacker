import { Result } from "@repo/shared/result";
import { defineAgent, defineDynamic } from "eve";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { decideCapability, requirePrincipal } from "../../lib/policy/index.ts";
import { LINEAR_RUNTIME } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) return undefined;
      const decision = decideCapability(principal.value, LINEAR_RUNTIME.subagentDescriptor);
      if (Result.isError(decision) || !decision.value.discover) return undefined;
      return defineAgent({
        description:
          "Manage Linear issues, projects, initiatives, documents, cycles, labels, teams, and users. " +
          "Use for project management, issues, tickets, sprints, epics, status updates, or Linear workspace data.",
        model: "anthropic/claude-sonnet-5",
        outputSchema: SUBAGENT_OUTPUT_SCHEMA,
      });
    },
  },
});
