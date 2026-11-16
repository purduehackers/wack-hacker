import { defineAgent, defineDynamic } from "eve";

import { subagentDiscoverable } from "../../lib/policy/discovery.ts";
import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/subagent-output.ts";
import { BUFFER_RUNTIME } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!subagentDiscoverable(ctx.session.auth.current, BUFFER_RUNTIME.subagentDescriptor)) {
        return undefined;
      }
      return defineAgent({
        description:
          "Manage Buffer social publishing, drafts, queues, ideas, content, notes, tags, templates, audio and post analytics through its complete public API.",
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
