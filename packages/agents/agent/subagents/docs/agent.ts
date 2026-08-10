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
            model: "deepseek/deepseek-v4-flash-0731",
            modelOptions: {
              providerOptions: {
                // DeepSeek caches implicitly, so this only matters if the gateway
                // ever falls back to a provider needing explicit cache markers.
                gateway: { caching: "auto" },
              },
            },
            outputSchema: SUBAGENT_OUTPUT_SCHEMA,
          })
        : undefined,
  },
});
