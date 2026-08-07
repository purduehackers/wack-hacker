/* oxlint-disable unicorn/no-null -- Eve dynamic resolvers use null as the documented absence sentinel. */
import { Result } from "@repo/shared/result";
import { defineAgent, defineDynamic } from "eve";

import { SUBAGENT_OUTPUT_SCHEMA } from "../../lib/core/subagent-output.ts";
import { decideCapability, requirePrincipal } from "../../lib/policy/index.ts";
import { NOTION_SUBAGENT_DESCRIPTOR } from "./lib/runtime.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const principal = requirePrincipal(ctx.session.auth.current);
      if (Result.isError(principal)) return null;
      const decision = decideCapability(principal.value, NOTION_SUBAGENT_DESCRIPTOR);
      if (Result.isError(decision) || !decision.value.discover) return null;
      return defineAgent({
        description:
          "Manage Notion workspace — pages, databases, and comments. When the user asks about direct Notion operations — creating/editing pages, querying databases, reading content, or managing comments.",
        model: "anthropic/claude-sonnet-5",
        outputSchema: SUBAGENT_OUTPUT_SCHEMA,
      });
    },
  },
});
