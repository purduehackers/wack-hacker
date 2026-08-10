import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, paginationInputShape } from "../../constants.ts";

export const list_teams = defineTool({
  description: `List teams in the purduehackers organization. Returns ID, name, slug, description, privacy, and URL.`,
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
  }),
  execute: async ({ per_page, page }) => {
    const { data } = await octokit().rest.teams.list({
      org: env.GITHUB_ORG,
      per_page: per_page ?? 30,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        description: t.description,
        privacy: t.privacy,
        html_url: t.html_url,
      })),
    );
  },
});
