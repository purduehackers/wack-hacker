import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const delete_file = defineTool({
  description: `Delete a file from a repository by creating a commit that removes it. Requires the file's current SHA (get it from get_file_content).`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    path: z.string().describe("File path to delete"),
    message: z.string().describe("Commit message"),
    sha: z.string().describe("SHA of the file to delete"),
    branch: z.string().exactOptional(),
  }),
  execute: async ({ repo, ...fields }) => {
    await octokit().rest.repos.deleteFile({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({ deleted: true, path: fields.path });
  },
});
