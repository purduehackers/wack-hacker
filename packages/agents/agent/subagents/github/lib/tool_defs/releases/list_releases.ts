import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoPaginatedInputShape } from "../../constants.ts";

export const list_releases = defineTool({
  description:
    "List releases for a repository, newest first. Returns tag name, title, draft/prerelease flags, created/published timestamps, and URL.",
  access: { risk: "read" },
  input: z.strictObject(repoPaginatedInputShape),
  execute: async ({ repo, per_page, page }) => {
    const { data } = await octokit().rest.repos.listReleases({
      owner: env.GITHUB_ORG,
      repo,
      per_page: per_page ?? 20,
      page: page ?? 1,
    });
    return JSON.stringify(
      data.map((r) => ({
        id: r.id,
        tag_name: r.tag_name,
        name: r.name,
        draft: r.draft,
        prerelease: r.prerelease,
        created_at: r.created_at,
        published_at: r.published_at,
        html_url: r.html_url,
      })),
    );
  },
});
