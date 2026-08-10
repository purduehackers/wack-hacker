import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, releaseId, repoField } from "../../constants.ts";

export const get_release = defineTool({
  description: "Get full details for a release including its body, assets, author, and timestamps.",
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    release_id: releaseId,
  }),
  execute: async ({ repo, release_id }) => {
    const { data } = await octokit().rest.repos.getRelease({
      owner: env.GITHUB_ORG,
      repo,
      release_id,
    });
    return JSON.stringify({
      id: data.id,
      tag_name: data.tag_name,
      name: data.name,
      body: data.body,
      draft: data.draft,
      prerelease: data.prerelease,
      author: data.author?.login,
      assets: data.assets.map((a) => ({
        name: a.name,
        size: a.size,
        download_count: a.download_count,
        browser_download_url: a.browser_download_url,
      })),
      created_at: data.created_at,
      published_at: data.published_at,
      html_url: data.html_url,
    });
  },
});
