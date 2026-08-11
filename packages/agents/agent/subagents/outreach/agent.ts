import { defineAgent, defineDynamic } from "eve";

import { subagentDiscoverable } from "../../lib/policy/discovery.ts";
import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/subagent-output.ts";
import { OUTREACH_RUNTIME } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!subagentDiscoverable(ctx.session.auth.current, OUTREACH_RUNTIME.subagentDescriptor)) {
        return undefined;
      }
      return defineAgent({
        description:
          "Drive the Notion-based CRM — query Companies/Contacts/Deals, enrich leads with verified email addresses, and send individual outreach mail recorded against the row that received it. When the user asks about the CRM, sponsorships, donors, leads, outreach emails, Deals, or sales pipeline activity.",
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
