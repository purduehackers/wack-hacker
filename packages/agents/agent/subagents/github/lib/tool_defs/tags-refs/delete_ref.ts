import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const delete_ref = defineTool({
  description:
    "Delete a git ref (branch or tag). Irreversible. Ref path without 'refs/' prefix (e.g. 'heads/old-branch').",
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    ref: z.string().min(1).describe("Ref path (e.g. 'heads/old-branch')"),
  }),
  execute: async ({ repo, ref }) => {
    await octokit().rest.git.deleteRef({
      owner: env.GITHUB_ORG,
      repo,
      ref,
    });
    return JSON.stringify({ deleted: true, ref });
  },
});
