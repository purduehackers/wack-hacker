import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, perPageField, repoField } from "../../constants.ts";

export const list_refs = defineTool({
  description:
    "List git refs (branches or tags) matching a prefix. Use 'heads/' for branches, 'tags/' for tags. Returns ref names and their target SHAs.",
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    namespace: z.enum(["heads", "tags"]).describe("heads for branches, tags for tags"),
    per_page: perPageField,
  }),
  execute: async ({ repo, namespace, per_page }) => {
    const { data } = await octokit().rest.git.listMatchingRefs({
      owner: env.GITHUB_ORG,
      repo,
      ref: namespace,
      per_page: per_page ?? 30,
    });
    return JSON.stringify(
      data.map((r) => ({
        ref: r.ref,
        sha: r.object.sha,
        type: r.object.type,
      })),
    );
  },
});
