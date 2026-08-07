/* oxlint-disable unicorn/no-null -- Eve dynamic resolvers use null as the documented absence sentinel. */
import { Result } from "@repo/shared/result";
import { defineAgent, defineDynamic } from "eve";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { decideCapability, requirePrincipal } from "../../lib/policy/index.ts";
import { FIGMA_SUBAGENT_DESCRIPTOR } from "./lib/descriptors.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) return null;
      const decision = decideCapability(principal.value, FIGMA_SUBAGENT_DESCRIPTOR);
      if (Result.isError(decision) || !decision.value.discover) return null;
      return defineAgent({
        description:
          "Browse and manage Figma files, components, styles, variables, comments, and webhooks. When the user asks about Figma designs, files, components, styles, design tokens, variables, comments, or dev resources.",
        model: "anthropic/claude-sonnet-5",
        outputSchema: SUBAGENT_OUTPUT_SCHEMA,
      });
    },
  },
});
