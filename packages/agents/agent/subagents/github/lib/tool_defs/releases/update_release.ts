import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, releaseId, repoField } from "../../constants.ts";

export const update_release = defineTool({
  description:
    "Update an existing release's tag name, title, body, draft/prerelease status, or target branch.",
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    release_id: releaseId,
    tag_name: z.string().min(1).exactOptional(),
    target_commitish: z.string().exactOptional(),
    name: z.string().exactOptional(),
    body: z.string().exactOptional(),
    draft: z.boolean().exactOptional(),
    prerelease: z.boolean().exactOptional(),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.repos.updateRelease({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      id: data.id,
      tag_name: data.tag_name,
      name: data.name,
      html_url: data.html_url,
    });
  },
});
