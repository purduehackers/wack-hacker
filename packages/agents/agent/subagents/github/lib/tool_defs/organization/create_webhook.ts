import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, webhookUrl } from "../../constants.ts";

export const create_webhook = defineTool({
  description: `Create a webhook for a repository. Specify payload URL, events, and optional secret for signature verification.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    url: webhookUrl,
    content_type: z.enum(["json", "form"]).optional(),
    secret: z.string().exactOptional().describe("Webhook secret for signature verification"),
    events: z.array(z.string()).describe("Events to subscribe to (e.g. ['push', 'pull_request'])"),
    active: z.boolean().optional(),
  }),
  execute: async ({ repo, url, content_type, secret, events, active }) => {
    const { data } = await octokit().rest.repos.createWebhook({
      owner: env.GITHUB_ORG,
      repo,
      config: {
        url,
        content_type: content_type ?? "json",
        ...(secret === undefined ? {} : { secret }),
      },
      events,
      active: active ?? true,
    });
    return JSON.stringify({
      id: data.id,
      active: data.active,
      events: data.events,
    });
  },
});
