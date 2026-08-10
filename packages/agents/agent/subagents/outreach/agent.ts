import { defineAgent, defineDynamic } from "eve";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { subagentDiscoverable } from "../../lib/policy/index.ts";
import { OUTREACH_RUNTIME } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!subagentDiscoverable(ctx.session.auth.current, OUTREACH_RUNTIME.subagentDescriptor)) {
        return undefined;
      }
      return defineAgent({
        description:
          "Drive the Notion-based CRM — query Companies/Contacts/Deals, enrich leads with emails, send outreach via Resend, and track send/open/click/bounce state. When the user asks about the CRM, sponsorships, donors, leads, outreach emails, Deals, or sales pipeline activity.",
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
