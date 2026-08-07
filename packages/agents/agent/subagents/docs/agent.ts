import { defineAgent, defineDynamic } from "eve";

import { isCoreToolVisible } from "../../lib/core/runtime.ts";
import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      isCoreToolVisible("documentation", ctx.session.auth.current)
        ? defineAgent({
            description:
              "Answer factual questions from the Purdue Hackers knowledge base about events, projects, documentation, history, culture, and organizational information.",
            model: "anthropic/claude-sonnet-5",
            outputSchema: SUBAGENT_OUTPUT_SCHEMA,
          })
        : undefined,
  },
});
