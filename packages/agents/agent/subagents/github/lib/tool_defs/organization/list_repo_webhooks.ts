import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoPaginatedInputShape } from "../../constants.ts";

export const list_repo_webhooks = defineTool({
  description: `List webhooks configured for a repository. Returns ID, active status, subscribed events, and config URL.`,
  access: { risk: "read" },
  input: z.strictObject(repoPaginatedInputShape),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.repos.listWebhooks({
      owner: env.GITHUB_ORG,
      repo,
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
