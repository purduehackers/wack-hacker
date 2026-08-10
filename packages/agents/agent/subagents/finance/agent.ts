import { defineAgent, defineDynamic } from "eve";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { subagentDiscoverable } from "../../lib/policy/index.ts";
import { FINANCE_RUNTIME } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!subagentDiscoverable(ctx.session.auth.current, FINANCE_RUNTIME.subagentDescriptor)) {
        return undefined;
      }
      return defineAgent({
        description:
          "Look up Hack Club Bank balances, transactions, donations, invoices, card charges, and transfers for Purdue Hackers. When the user asks about money, budget, balance, donations, sponsor invoices, card spend, microgrant spend, receipts, or finances.",
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
