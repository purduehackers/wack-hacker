import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, teamSlug } from "../../constants.ts";

export const get_team = defineTool({
  description: `Get details for a team by slug. Returns ID, name, description, privacy, and URL.`,
  access: { risk: "read" },
  input: z.strictObject({
    team_slug: teamSlug.describe("Team slug (e.g. 'engineering')"),
  }),
  execute: async ({ team_slug }) => {
    const { data } = await octokit().rest.teams.getByName({
      org: env.GITHUB_ORG,
      team_slug,
    });
    return JSON.stringify({
      id: data.id,
      name: data.name,
      slug: data.slug,
      description: data.description,
      privacy: data.privacy,
      html_url: data.html_url,
    });
  },
});
