/* oxlint-disable unicorn/no-null -- Eve dynamic resolvers use null as the documented absence sentinel. */
import { Result } from "@repo/shared/result";
import { defineAgent, defineDynamic } from "eve";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { decideCapability, requirePrincipal } from "../../lib/policy/index.ts";
import { SHOPPING_RUNTIME } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) return null;
      const decision = decideCapability(principal.value, SHOPPING_RUNTIME.subagentDescriptor);
      if (Result.isError(decision) || !decision.value.discover) return null;
      return defineAgent({
        description:
          "Search Amazon and manage a shared virtual shopping cart (wishlist — no real checkout). When the user wants to search Amazon products, add/remove items from the team cart, or view the shared cart.",
        model: "anthropic/claude-sonnet-5",
        outputSchema: SUBAGENT_OUTPUT_SCHEMA,
      });
    },
  },
});
