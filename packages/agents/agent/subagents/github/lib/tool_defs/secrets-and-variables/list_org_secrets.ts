import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, paginationInputShape } from "../../constants.ts";

export const list_org_secrets = defineTool({
  description: `List Actions secrets for the purduehackers organization. Returns names, timestamps, and visibility scope. Values are never readable.`,
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
  }),
  execute: async ({ per_page, page }) => {
    const { data } = await octokit().rest.actions.listOrgSecrets({
      org: env.GITHUB_ORG,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify({
      total_count: data.total_count,
      secrets: data.secrets.map((s) => ({
        name: s.name,
        created_at: s.created_at,
        updated_at: s.updated_at,
        visibility: s.visibility,
      })),
    });
  },
});
