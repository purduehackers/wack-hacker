/* oxlint-disable unicorn/no-null -- Eve dynamic resolvers use null as the documented absence sentinel. */
import { Result } from "@repo/shared/result";
import { defineAgent, defineDynamic } from "eve";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { decideCapability, requirePrincipal } from "../../lib/policy/index.ts";
import { FINANCE_SUBAGENT_DESCRIPTOR } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) return null;
      const decision = decideCapability(principal.value, FINANCE_SUBAGENT_DESCRIPTOR);
      if (Result.isError(decision) || !decision.value.discover) return null;
      return defineAgent({
        description:
          "Look up Hack Club Bank balances, transactions, donations, invoices, card charges, and transfers for Purdue Hackers. When the user asks about money, budget, balance, donations, sponsor invoices, card spend, microgrant spend, receipts, or finances.",
        model: "anthropic/claude-sonnet-5",
        outputSchema: SUBAGENT_OUTPUT_SCHEMA,
      });
    },
  },
});
