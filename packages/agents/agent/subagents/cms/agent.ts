import { defineAgent, defineDynamic } from "eve";

import { subagentDiscoverable } from "../../lib/policy/index.ts";
import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/subagent-output.ts";
import { CMS_RUNTIME } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!subagentDiscoverable(ctx.session.auth.current, CMS_RUNTIME.subagentDescriptor)) {
        return undefined;
      }
      return defineAgent({
        description:
          "Manage Purdue Hackers website content in Payload CMS at cms.purduehackers.com — events, " +
          "RSVPs, email blasts, hack night sessions, microgrant and shelter showcases, the media " +
          "library, CMS users, and service accounts. Use for events on purduehackers.com, RSVPs, " +
          "email blasts, hack nights, ugrants, shelter projects, media, or CMS access.",
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
