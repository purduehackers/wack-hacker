import { defineDynamic, defineTool } from "eve/tools";

import { env } from "../env.ts";
import { integrationDomainNamed, integrationTool } from "../lib/catalog/access.ts";
import { INTEGRATION_DOMAINS } from "../lib/catalog/domains.ts";
import { guardToolExecution } from "../lib/serialization.ts";

export default defineDynamic({
  events: {
    "step.started": async (_event, ctx) => {
      if (!env.MAIN_AGENT_CATALOG_ENABLED) return {};
      const catalogs = await Promise.all(
        Object.keys(INTEGRATION_DOMAINS).map(async (domainName) => {
          const names = await integrationDomainNamed(domainName).visibleToolNames(
            ctx.session.auth.current,
          );
          return names.map((toolName) => [
            `${domainName}__${toolName}`,
            defineTool({
              deferred: true,
              description: integrationTool(domainName, toolName).description,
              // Inline lookup lets Eve replay the live Zod validator by names,
              // instead of serializing a resolver-local schema or SDK object.
              inputSchema: integrationTool(domainName, toolName).input,
              approval: async (approvalCtx) =>
                await integrationDomainNamed(domainName).approval(toolName, approvalCtx),
              execute: async (input, toolCtx) =>
                guardToolExecution(
                  async () =>
                    await integrationDomainNamed(domainName).execute(toolName, input, toolCtx),
                ),
            }),
          ]);
        }),
      );
      return Object.fromEntries(catalogs.flat());
    },
  },
});
