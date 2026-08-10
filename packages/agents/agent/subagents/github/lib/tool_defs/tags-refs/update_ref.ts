import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { commitSha, env, repoField } from "../../constants.ts";

export const update_ref = defineTool({
  description:
    "Update a ref to point to a different commit SHA. For branches, equivalent to a fast-forward or force-push (set force=true for non-fast-forward).",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    ref: z.string().min(1).describe("Ref path WITHOUT the 'refs/' prefix (e.g. 'heads/main')"),
    sha: commitSha.describe("New target SHA"),
    force: z.boolean().default(false).describe("Allow non-fast-forward (default false)"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.git.updateRef({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({ ref: data.ref, sha: data.object.sha });
  },
});
