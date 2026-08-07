import { defineAgent, defineDynamic } from "eve";

import { decideCodeCapability } from "../../lib/code-sandbox/policy.ts";
import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";

const DESCRIPTION =
  "Inspect or change one public Purdue Hackers repository in a bounded Eve-provisioned sandbox. Use for bug fixes, features, refactors, tests, configuration, and repository-specific code investigation. Repository checkout and every mutation require current-admin approval.";

/** Hidden from non-admins and re-evaluated from auth.current on every parent turn. */
export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const decision = decideCodeCapability(ctx.session.auth.current, "code", "read", "subagent");
      return decision.allowed
        ? defineAgent({
            description: DESCRIPTION,
            model: "anthropic/claude-sonnet-5",
            outputSchema: SUBAGENT_OUTPUT_SCHEMA,
            limits: {
              maxInputTokensPerSession: 500_000,
              maxOutputTokensPerSession: 50_000,
              sessionTimeoutMs: 60 * 60_000,
            },
          })
        : undefined;
    },
  },
});
