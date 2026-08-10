import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, hookId, repoField } from "../../constants.ts";

export const delete_webhook = defineTool({
  description: `Delete a repository webhook. Irreversible — the webhook stops receiving events immediately.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    hook_id: hookId,
  }),
  execute: async ({ repo, hook_id }) => {
    await octokit().rest.repos.deleteWebhook({
      owner: env.GITHUB_ORG,
      repo,
      hook_id,
    });
    return JSON.stringify({ deleted: true, hook_id });
  },
});
