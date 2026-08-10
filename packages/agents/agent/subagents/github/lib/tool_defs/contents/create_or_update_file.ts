import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const create_or_update_file = defineTool({
  description: `Create or update a file in a repository. The content is provided as plain text and will be base64-encoded automatically. For updates, you must provide the current file's SHA (get it from get_file_content). Returns the file path, new SHA, URL, and commit SHA.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    path: z.string().describe("File path"),
    content: z.string().describe("File content (plain text, will be base64-encoded)"),
    message: z.string().describe("Commit message"),
    branch: z.string().exactOptional().describe("Branch (defaults to default branch)"),
    sha: z
      .string()
      .exactOptional()
      .describe("SHA of the file being replaced (required for update)"),
  }),
  execute: async ({ repo, content, ...fields }) => {
    const { data } = await octokit().rest.repos.createOrUpdateFileContents({
      owner: env.GITHUB_ORG,
      repo,
      content: Buffer.from(content).toString("base64"),
      ...fields,
    });
    return JSON.stringify({
      path: data.content?.path,
      sha: data.content?.sha,
      html_url: data.content?.html_url,
      commit_sha: data.commit.sha,
    });
  },
});
