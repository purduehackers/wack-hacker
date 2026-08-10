import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, perPageField, releaseId, repoField } from "../../constants.ts";

export const list_release_assets = defineTool({
  description:
    "List assets (attached files) on a release. Returns name, size, download count, and download URL.",
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    release_id: releaseId,
    per_page: perPageField,
  }),
  execute: async ({ repo, release_id, per_page }) => {
    const { data } = await octokit().rest.repos.listReleaseAssets({
      owner: env.GITHUB_ORG,
      repo,
      release_id,
      per_page: per_page ?? 30,
    });
    return JSON.stringify(
      data.map((a) => ({
        id: a.id,
        name: a.name,
        size: a.size,
        download_count: a.download_count,
        browser_download_url: a.browser_download_url,
      })),
    );
  },
});
