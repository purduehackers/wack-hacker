/* oxlint-disable unicorn/no-null -- Eve dynamic resolvers use null as the documented absence sentinel. */
import { Result } from "@repo/shared/result";
import { defineAgent, defineDynamic } from "eve";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { decideCapability, requirePrincipal } from "../../lib/policy/index.ts";
import { OUTREACH_SUBAGENT_DESCRIPTOR } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) return null;
      const decision = decideCapability(principal.value, OUTREACH_SUBAGENT_DESCRIPTOR);
      if (Result.isError(decision) || !decision.value.discover) return null;
      return defineAgent({
        description:
          "Drive the Notion-based CRM — query Companies/Contacts/Deals, enrich leads with emails, send outreach via Resend, and track send/open/click/bounce state. When the user asks about the CRM, sponsorships, donors, leads, outreach emails, Deals, or sales pipeline activity.",
        model: "anthropic/claude-sonnet-5",
        outputSchema: SUBAGENT_OUTPUT_SCHEMA,
      });
    },
  },
});
