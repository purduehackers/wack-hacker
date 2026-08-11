import { defineAgent, defineDynamic } from "eve";

import { subagentDiscoverable } from "../../lib/policy/index.ts";
import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/subagent-output.ts";
import { VERCEL_RUNTIME } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      if (!subagentDiscoverable(ctx.session.auth.current, VERCEL_RUNTIME.subagentDescriptor)) {
        return undefined;
      }
      return defineAgent({
        description:
          "Operate Vercel projects, deployments, domains, observability, integrations, edge-platform features, security, rolling releases, and sandboxes.",
        model: "anthropic/claude-sonnet-5",
        outputSchema: SUBAGENT_OUTPUT_SCHEMA,
      });
    },
  },
});
