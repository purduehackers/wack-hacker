import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const get_ref = defineTool({
  description: "Get a single git ref (branch or tag) by its full name (e.g. 'heads/main').",
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    ref: z.string().min(1).describe("Ref path (e.g. 'heads/main', 'tags/v1.0.0')"),
  }),
  execute: async ({ repo, ref }) => {
    const { data } = await octokit().rest.git.getRef({
      owner: env.GITHUB_ORG,
      repo,
      ref,
    });
    return JSON.stringify({ ref: data.ref, sha: data.object.sha, type: data.object.type });
  },
});
