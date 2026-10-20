import { defineDynamic, defineInstructions } from "eve/instructions";

import { env } from "../env.ts";

export default defineDynamic({
  events: {
    "turn.started": () =>
      defineInstructions({
        content: env.MAIN_AGENT_CATALOG_ENABLED
          ? [
              "# Provider execution",
              "Perform ordinary integration work directly on the main agent. Search with eve__search, load the provider's <domain>__overview or relevant namespaced skill with eve__skill, then call namespaced operations with eve__tool.",
              "Search discloses the selected schema; do not guess operation names or input properties. Load provider guidance before acting, including for base operations.",
              "Use independent tool calls in parallel. Delegate only a substantial independent task that benefits from a separate context, never merely because the work crosses a provider boundary.",
              "Integrations use Wack and organization-managed credentials. Missing configuration is an operator issue; do not ask users to connect personal accounts, supply tokens, or configure MCP.",
            ].join("\n\n")
          : "Delegate provider work to the matching authorized specialist. Provider credentials are managed by Wack and the organization; never ask users to connect personal accounts or supply tokens.",
      }),
  },
});
