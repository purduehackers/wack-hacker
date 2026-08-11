import { defineAgent, defineDynamic } from "eve";

import { subagentDiscoverable } from "../../lib/policy/discovery.ts";
import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/subagent-output.ts";
import { SHOPPING_RUNTIME } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!subagentDiscoverable(ctx.session.auth.current, SHOPPING_RUNTIME.subagentDescriptor)) {
        return undefined;
      }
      return defineAgent({
        description:
          "Search Amazon and manage a shared virtual shopping cart (wishlist — no real checkout). When the user wants to search Amazon products, add/remove items from the team cart, or view the shared cart.",
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
