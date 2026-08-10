import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const get_file_content = defineTool({
  description: `Get the content of a file or list entries in a directory. For files, returns the decoded content (truncated at 50k chars), SHA, and URL. For directories, returns a list of entries with name, path, type, and size. Use the 'ref' param to read from a specific branch or tag.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    path: z.string().describe("File or directory path"),
    ref: z.string().exactOptional().describe("Branch/tag/SHA (defaults to default branch)"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.repos.getContent({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    if (Array.isArray(data)) {
      return JSON.stringify(
        data.map((f) => ({
          name: f.name,
          path: f.path,
          type: f.type,
          size: f.size,
        })),
      );
    }
    if (data.type === "file" && "content" in data) {
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return JSON.stringify({
        name: data.name,
        path: data.path,
        size: data.size,
        sha: data.sha,
        content: content.length > 50_000 ? content.slice(0, 50_000) + "\n...(truncated)" : content,
        html_url: data.html_url,
      });
    }
    return JSON.stringify({
      name: data.name,
      path: data.path,
      type: data.type,
      size: data.size,
    });
  },
});
