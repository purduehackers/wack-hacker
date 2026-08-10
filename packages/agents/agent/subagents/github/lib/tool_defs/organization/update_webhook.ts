import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, hookId, repoField, webhookUrl } from "../../constants.ts";

export const update_webhook = defineTool({
  description: `Update a repository webhook's URL, events, secret, or active status. Only provided fields are changed.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    hook_id: hookId,
    url: webhookUrl.exactOptional(),
    content_type: z.enum(["json", "form"]).exactOptional(),
    // An empty secret is not "leave it alone" — GitHub reads it as "clear the
    // signing secret", so it is rejected rather than forwarded.
    secret: z.string().min(1).exactOptional(),
    events: z.array(z.string()).exactOptional(),
    active: z.boolean().exactOptional(),
  }),
  execute: async ({ repo, hook_id, url, content_type, secret, ...fields }) => {
    const config = {
      ...(url === undefined ? {} : { url }),
      ...(content_type === undefined ? {} : { content_type }),
      ...(secret === undefined ? {} : { secret }),
    };
    const { data } = await octokit().rest.repos.updateWebhook({
      owner: env.GITHUB_ORG,
      repo,
      hook_id,
      ...(Object.keys(config).length === 0 ? {} : { config }),
      ...fields,
    });
    return JSON.stringify({
      id: data.id,
      active: data.active,
      events: data.events,
    });
  },
});
