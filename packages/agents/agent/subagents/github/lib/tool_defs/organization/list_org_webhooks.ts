import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, paginationInputShape } from "../../constants.ts";

export const list_org_webhooks = defineTool({
  description: `List webhooks configured for the purduehackers organization. Returns ID, active status, subscribed events, and config URL.`,
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
  }),
  execute: async ({ per_page, page }) => {
    const { data } = await octokit().rest.orgs.listWebhooks({
      org: env.GITHUB_ORG,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((w) => ({
        id: w.id,
        name: w.name,
        active: w.active,
        events: w.events,
        config: { url: w.config.url, content_type: w.config.content_type },
      })),
    );
  },
});
