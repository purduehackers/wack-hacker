import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { commitSha, env, repoField } from "../../constants.ts";

export const create_ref = defineTool({
  description:
    "Create a new branch or tag. For branches use ref='refs/heads/my-branch'; for tags use 'refs/tags/v1.0.0'. Requires the target commit SHA.",
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    ref: z
      .templateLiteral(["refs/", z.enum(["heads", "tags"]), "/", z.string().min(1)])
      .describe("Full ref name (e.g. 'refs/heads/new-branch')"),
    sha: commitSha.describe("Target commit SHA"),
  }),
  execute: async ({ repo, ref, sha }) => {
    const { data } = await octokit().rest.git.createRef({
      owner: env.GITHUB_ORG,
      repo,
      ref,
      sha,
    });
    return JSON.stringify({ ref: data.ref, sha: data.object.sha });
  },
});
