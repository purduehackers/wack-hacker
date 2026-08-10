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
            model: "openai/gpt-5.6-luna",
            /**
             * Code work is the one place worth paying for depth. `xhigh` is the
             * highest effort this family exposes short of `max`, which the
             * gateway catalog lists but which costs far more for marginal gain
             * on bounded repository edits.
             */
            reasoning: "xhigh",
            modelOptions: {
              providerOptions: {
                gateway: {
                  // Restricts routing and fallbacks to these providers. The
                  // request fails outright if neither can serve the model, which
                  // is the intended behaviour: no silent reroute to a third
                  // party for repository-mutating work.
                  only: ["openai", "bedrock"],
                  // OpenAI caches implicitly, so this is a no-op there; it earns
                  // its place if the request lands on Bedrock, where the gateway
                  // inserts the cache breakpoints itself.
                  caching: "auto",
                },
                openai: {
                  // Condensed thought summaries, so approval prompts can show
                  // why a mutation was proposed.
                  reasoningSummary: "auto",
                },
              },
            },
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
